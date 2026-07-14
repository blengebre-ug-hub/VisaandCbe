require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const QRCode   = require('qrcode');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── PostgreSQL Connection Pool ────────────────────────────────────────────────
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required for production hosted databases like Neon
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT, 10) || 5432,
      user:     process.env.DB_USER     || 'postgres',
      password: String(process.env.DB_PASSWORD ?? ''),
      database: process.env.DB_NAME     || 'rsvp',
    };

const pool = new Pool(poolConfig);

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ PostgreSQL connection failed:');
    console.error(err);
  } else {
    console.log('✅ PostgreSQL connected successfully.');
    release();
    initializeDatabase();
  }
});

// ─── Auto-create table if it doesn't exist ────────────────────────────────────
async function initializeDatabase() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS rsvps (
      id               VARCHAR(20)  PRIMARY KEY,
      name             VARCHAR(255) NOT NULL,
      email            VARCHAR(255),
      phone            VARCHAR(50)  NOT NULL UNIQUE,
      organization     VARCHAR(255) DEFAULT '',
      meal_preference  VARCHAR(100),
      special_requests TEXT,
      team             VARCHAR(50),
      score_home       INT,
      score_away       INT,
      goal_scorer      VARCHAR(255),
      guest_count      INT          DEFAULT 1,
      fan_points       INT          DEFAULT 0,
      badges           TEXT[],
      referral_code    VARCHAR(20)  UNIQUE,
      referred_by      VARCHAR(20),
      halftime_home    INT,
      halftime_away    INT,
      check_in_status  VARCHAR(20)  DEFAULT 'Not Yet',
      check_in_time    VARCHAR(20),
      created_at       TIMESTAMPTZ  DEFAULT NOW()
    );
  `;
  const alterColumns = [
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS team VARCHAR(50)`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS score_home INT`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS score_away INT`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS goal_scorer VARCHAR(255)`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS guest_count INT DEFAULT 1`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS fan_points INT DEFAULT 0`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS badges TEXT[]`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS referred_by VARCHAR(20)`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS halftime_home INT`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS halftime_away INT`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS check_in_status VARCHAR(20) DEFAULT 'Not Yet'`,
    `ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS check_in_time VARCHAR(20)`,
    `ALTER TABLE rsvps ALTER COLUMN email DROP NOT NULL`,
    `ALTER TABLE rsvps ALTER COLUMN organization SET DEFAULT ''`
  ];
  try {
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS rsvp_counter_seq START WITH 100;`);
    
    await pool.query(createTableSQL);
    for (const sql of alterColumns) {
      try { await pool.query(sql); } catch (_) { /* Safe fallback */ }
    }
    console.log('✅ Table "rsvps" is ready.');
  } catch (err) {
    console.error('❌ Failed to create table:', err.message);
  }
}

function generateReferralCode() {
  return 'FAN' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function calculateFanPoints({ team, scoreHome, scoreAway, referredBy }) {
  let points = 100; // Register
  if (team) points += 50;
  if (scoreHome !== undefined && scoreAway !== undefined) points += 50;
  if (referredBy) points += 100;
  return points;
}

function calculateBadges({ team, scoreHome, scoreAway, referredBy, createdAt }) {
  const badges = [];
  const earlyBirdCutoff = new Date('2026-07-15T00:00:00+03:00');
  if (new Date(createdAt || Date.now()) < earlyBirdCutoff) badges.push('Early Bird');
  if (team && scoreHome !== undefined) badges.push('Match Predictor');
  if (referredBy) badges.push('Super Fan');
  return badges;
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getFormattedTime() {
  const date = new Date();
  let hours   = date.getHours();
  const mins  = date.getMinutes().toString().padStart(2, '0');
  const ampm  = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${mins} ${ampm}`;
}

// ─── API: Submit RSVP ─────────────────────────────────────────────────────────
app.post('/api/rsvp', async (req, res) => {
  const {
    name, email, phone, organization, mealPreference, specialRequests, referredBy
  } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }

  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const cleanPhone = phone.trim();
  const cleanOrg = (organization || '').trim();

  try {
    // ── 1. Duplicate check ──────────────────────────────────────────────────
    let dupCheck;
    if (cleanEmail) {
      dupCheck = await pool.query(
        'SELECT id FROM rsvps WHERE phone = $1 OR (email IS NOT NULL AND email = $2)',
        [cleanPhone, cleanEmail]
      );
    } else {
      dupCheck = await pool.query('SELECT id FROM rsvps WHERE phone = $1', [cleanPhone]);
    }

    if (dupCheck.rows.length > 0) {
      return res.status(400).json({
        error: 'A reservation with this phone number already exists.'
      });
    }

    // ── 2. Generate sequential Reservation ID ───────────────────────────────
    const seqResult = await pool.query("SELECT nextval('rsvp_counter_seq') AS next_id");
    const nextCounter = seqResult.rows[0].next_id;
    const reservationId = `VIP-2026-${String(nextCounter).padStart(6, '0')}`;

    // ── 3. Generate QR Code directly into memory buffer ───────────────────
    const qrDataUrl = await QRCode.toDataURL(reservationId, {
      color: { dark: '#3A125E', light: '#FFFFFF' },
      width: 300,
      margin: 2
    });
    const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

    const referralCode = generateReferralCode();
    const fanPoints = calculateFanPoints({ referredBy });
    const badges = calculateBadges({ referredBy });
    const guests = 1;

    // ── 4. Save to PostgreSQL ───────────────────────────────────────────────
    await pool.query(
      `INSERT INTO rsvps
         (id, name, email, phone, organization, meal_preference, special_requests,
          team, score_home, score_away, goal_scorer, guest_count, fan_points, badges,
          referral_code, referred_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        reservationId,
        name.trim(),
        cleanEmail || null,
        cleanPhone,
        cleanOrg,
        (mealPreference  || '').trim(),
        (specialRequests || '').trim(),
        null,
        null,
        null,
        null,
        guests,
        fanPoints,
        badges,
        referralCode,
        referredBy || null
      ]
    );

    if (referredBy) {
      await pool.query(
        `UPDATE rsvps SET fan_points = fan_points + 100,
         badges = CASE WHEN 'Super Fan' = ANY(badges) THEN badges
                  ELSE array_append(COALESCE(badges, '{}'), 'Super Fan') END
         WHERE referral_code = $1`,
        [referredBy]
      );
    }

    console.log(`✅ RSVP saved: ${reservationId} — ${name.trim()} (${fanPoints} pts)`);

    // ── 5. Build Clean Confirmation Email HTML (Science Museum & 6:00 PM) ──
    const productionBaseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : `http://localhost:${PORT}`;
    const qrImageUrl = `${productionBaseUrl}/qrcodes/${reservationId}.png`;
    
    const emailBodyHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your FIFA World Cup 2026 VIP Reservation</title>
</head>
<body style="margin:0;padding:0;background:#0d1b4b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d1b4b;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">

        <tr>
          <td style="height:6px;background:linear-gradient(90deg,#D4AF37 0%,#f5e06e 50%,#D4AF37 100%);"></td>
        </tr>

        <tr>
          <td style="background:linear-gradient(135deg,#0a1547 0%,#1a2f8f 60%,#0d1b4b 100%);padding:36px 40px;text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding-bottom:24px;">
                  <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
                    <tr>
                      <td style="background:#1a1f71;border-radius:6px;padding:8px 16px;vertical-align:middle;">
                        <img src="cid:visalogo" alt="VISA" style="display:block; border:0; height:24px; width:auto;" />
                      </td>
                      <td width="12" style="width:12px;">&nbsp;</td>
                      <td style="background:#0a1547;border-radius:6px;padding:8px 16px;vertical-align:middle;">
                        <img src="cid:cbelogo" alt="CBE" style="display:block; border:0; height:24px; width:auto;" />
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <h1 style="margin:0 0 6px;color:#D4AF37;font-size:26px;font-weight:800;letter-spacing:3px;text-shadow:0 0 20px rgba(212,175,55,0.4);">FIFA WORLD CUP 2026™</h1>
            <p style="margin:0;color:#a8bce8;font-size:13px;letter-spacing:4px;text-transform:uppercase;">Final Viewing Party · VIP Invitation</p>
          </td>
        </tr>

        <tr>
          <td style="padding:40px 40px 0;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#0a1547;text-transform:uppercase;letter-spacing:2px;">Dear Guest,</p>
            <h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0a1547;">${name.trim()}</h2>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#444;">
              Your reservation for the <strong>FIFA World Cup 2026™ Final Viewing Party</strong> has been confirmed.
              Please present the QR code below upon arrival to access the VIP lounge.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4ff;border-radius:12px;border-left:4px solid #1a2f8f;overflow:hidden;">
              <tr><td style="padding:24px 24px 24px;">
                <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#888;">Reservation ID</p>
                <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#0a1547;font-family:monospace;">${reservationId}</p>

                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="50%" style="padding-bottom:14px;">
                      <p style="margin:0 0 3px;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#888;">Date</p>
                      <p style="margin:0;font-size:14px;font-weight:600;color:#0a1547;">Sunday, July 19, 2026</p>
                    </td>
                    <td width="50%" style="padding-bottom:14px;">
                      <p style="margin:0 0 3px;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#888;">Time</p>
                      <p style="margin:0;font-size:14px;font-weight:600;color:#0a1547;">6:00 PM Onwards</p>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2">
                      <p style="margin:0 0 3px;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#888;">Venue</p>
                      <p style="margin:0;font-size:14px;font-weight:600;color:#0a1547;">Science Museum<br><span style="font-weight:400;color:#555;">Addis Ababa, Ethiopia</span></p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0a1547,#1a2f8f);border-radius:12px;">
              <tr>
                <td style="padding:28px;text-align:center;">
                  <p style="margin:0 0 16px;color:#D4AF37;font-size:11px;text-transform:uppercase;letter-spacing:3px;font-weight:600;">Your VIP Entry Pass</p>
                  <div style="display:inline-block;background:#ffffff;border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3);">
                    <img src="cid:qrcode" alt="VIP Entry QR Code" width="180" height="180" style="display:block;border-radius:6px;">
                  </div>
                  <p style="margin:16px 0 0;color:#a8bce8;font-size:13px;">Scan at the entrance for VIP access</p>
                  <p style="margin:10px 0 0;"><a href="${qrImageUrl}" style="color:#D4AF37;font-size:12px;text-decoration:none;">View QR Code Online</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #eee;"></td></tr>

        <tr>
          <td style="padding:28px 40px;text-align:center;background:#f8f9ff;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 16px;">
              <tr>
                <td style="background:#1a1f71;border-radius:6px;padding:8px 16px;vertical-align:middle;">
                  <img src="cid:visalogo" alt="VISA" style="display:block; border:0; height:24px; width:auto;" />
                </td>
                <td width="12" style="width:12px;">&nbsp;</td>
                <td style="background:#0a1547;border-radius:6px;padding:8px 16px;vertical-align:middle;">
                  <img src="cid:cbelogo" alt="CBE" style="display:block; border:0; height:24px; width:auto;" />
                </td>
              </tr>
            </table>
            <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#333;">Commercial Bank of Ethiopia &amp; Visa International</p>
            <p style="margin:0;font-size:12px;color:#888;">This is an official VIP invitation. Do not share this QR code with others.</p>
            <p style="margin:8px 0 0;font-size:11px;color:#bbb;">© 2026 FIFA World Cup 2026 Final Viewing Party</p>
          </td>
        </tr>

        <tr>
          <td style="height:4px;background:linear-gradient(90deg,#D4AF37 0%,#f5e06e 50%,#D4AF37 100%);"></td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `;

    // ── 6. Send email if SMTP is configured ─────────────────────────────────
    let emailSent = false;
    if (cleanEmail && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host:   process.env.SMTP_HOST,
          port:   parseInt(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          tls:    { rejectUnauthorized: false }
        });
        
        const plainTextBody = `
Dear ${name.trim()},

Your reservation for the FIFA World Cup 2026 Final Viewing Party has been confirmed.

Reservation ID: ${reservationId}
Date: Sunday, July 19, 2026
Time: 6:00 PM Onwards
Venue: Science Museum, Addis Ababa, Ethiopia

You can view your QR Code entry pass here:
${qrImageUrl}

Thank you,
Commercial Bank of Ethiopia & Visa International
        `.trim();

        // Safe setup of attachments (Avoid local disk crash if files are missing)
        const attachments = [
          { 
            filename: `VIP-Pass-QRCode-${reservationId}.png`, 
            content: qrBuffer, 
            cid: 'qrcode' 
          }
        ];

        const visaLogoPath = path.join(__dirname, 'assets', 'brand', 'visa-fifa-colored.png');
        const cbeLogoPath = path.join(__dirname, 'assets', 'brand', 'cbe-logo-transparent.png');

        // Gracefully append brand logo assets if they physically exist
        if (fs.existsSync(visaLogoPath)) {
          attachments.push({ filename: 'visa-fifa-colored.png', path: visaLogoPath, cid: 'visalogo' });
        }
        if (fs.existsSync(cbeLogoPath)) {
          attachments.push({ filename: 'cbe-logo-transparent.png', path: cbeLogoPath, cid: 'cbelogo' });
        }

        await transporter.sendMail({
          from:        `"CBE & Visa VIP Events" <${process.env.SMTP_USER}>`,
          to:          cleanEmail,
          replyTo:     process.env.SMTP_USER,
          subject:     `Your FIFA World Cup 2026 VIP Pass: ${reservationId}`,
          text:        plainTextBody,
          html:        emailBodyHTML,
          attachments: attachments
        });
        emailSent = true;
        console.log(`📧 Confirmation email sent to: ${cleanEmail}`);
      } catch (mailErr) {
        console.error('⚠️ SMTP send failed:', mailErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      reservationId,
      qrDataUrl,
      emailSent,
      fanPoints,
      badges,
      referralCode
    });

  } catch (err) {
    console.error('❌ RSVP error:', err.message);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ─── API: Leaderboard ─────────────────────────────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, fan_points AS "fanPoints"
       FROM rsvps
       ORDER BY fan_points DESC, created_at ASC
       LIMIT 20`
    );
    return res.status(200).json({ leaderboard: result.rows });
  } catch (err) {
    console.error('❌ Leaderboard error:', err.message);
    return res.status(500).json({ error: 'Could not load leaderboard.' });
  }
});

// ─── API: Halftime Prediction ─────────────────────────────────────────────────
app.post('/api/rsvp/:id/halftime', async (req, res) => {
  const id = req.params.id.trim().toUpperCase();
  const { scoreHome, scoreAway } = req.body;
  try {
    const found = await pool.query('SELECT * FROM rsvps WHERE id = $1', [id]);
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found.' });
    }
    const r = found.rows[0];
    if (r.halftime_home !== null) {
      return res.status(400).json({ error: 'Halftime prediction already submitted.' });
    }
    const bonus = 25;
    const updated = await pool.query(
      `UPDATE rsvps SET halftime_home = $1, halftime_away = $2, fan_points = fan_points + $3
       WHERE id = $4 RETURNING fan_points`,
      [scoreHome, scoreAway, bonus, id]
    );
    return res.status(200).json({ success: true, fanPoints: updated.rows[0].fan_points });
  } catch (err) {
    console.error('❌ Halftime error:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }
});


// ─── API: Lookup Reservation details (For Staff Portal) ──────────────────────
app.get('/api/rsvp/:id', async (req, res) => {
  const id = req.params.id.trim().toUpperCase();
  try {
    const result = await pool.query('SELECT * FROM rsvps WHERE UPPER(id) = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Reservation ID "${id}" could not be found.` });
    }
    return res.status(200).json({ success: true, rsvp: result.rows[0] });
  } catch (err) {
    console.error('❌ Lookup error:', err.message);
    return res.status(500).json({ error: 'Database query error.' });
  }
});

// ─── API: Event Check-In ──────────────────────────────────────────────────────
app.post('/api/checkin', async (req, res) => {
  let { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Reservation ID is required.' });
  }

  let cleanId = id.replace(/['"]+/g, '').trim().toUpperCase();

  try {
    const result = await pool.query('SELECT * FROM rsvps WHERE UPPER(id) = $1', [cleanId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: `Reservation ID "${cleanId}" could not be found in the database. Please check the ID and try again.`
      });
    }

    const rsvp = result.rows[0];

    if (rsvp.check_in_status === 'Checked In') {
      return res.status(200).json({ success: true, alreadyCheckedIn: true, message: `${rsvp.name} is already checked in.`, rsvp });
    }

    const checkInTime = getFormattedTime();
    await pool.query(`UPDATE rsvps SET check_in_status = 'Checked In', check_in_time = $1 WHERE id = $2`, [checkInTime, rsvp.id]);

    return res.status(200).json({ success: true, message: `Successfully checked in ${rsvp.name}!`, rsvp });

  } catch (err) {
    console.error('❌ Check-in database error:', err.message);
    return res.status(500).json({ error: 'Database error processing check-in.' });
  }
});

// ─── API: Serve QR Code Image (On-the-Fly Secure Generation) ─────────────────
app.get('/qrcodes/:id.png', async (req, res) => {
  const id = req.params.id.replace('.png', '').trim().toUpperCase();
  
  try {
    // 1. Verify ID exists in DB to prevent random QR code scrapers
    const result = await pool.query('SELECT id FROM rsvps WHERE UPPER(id) = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR Code not found.' });
    }

    // 2. Generate QR directly into dynamic memory stream & send back to browser
    res.setHeader('Content-Type', 'image/png');
    QRCode.toFileStream(res, id, {
      color: { dark: '#3A125E', light: '#FFFFFF' },
      width: 300,
      margin: 2
    });
  } catch (err) {
    console.error('❌ Dynamic QR delivery failed:', err.message);
    res.status(500).json({ error: 'Failed to generate asset.' });
  }
});

// ─── Start Server ─────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}
 
module.exports = app;