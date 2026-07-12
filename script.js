document.addEventListener('DOMContentLoaded', () => {
  // ─── Elements ───────────────────────────────────────────────────────────────
  const loadingScreen = document.getElementById('loading-screen');
  const loadingVideo = document.getElementById('loading-video');
  const appContainer = document.getElementById('app-container');
  const bgAudio = document.getElementById('bg-audio');
  const btnSoundToggle = document.getElementById('btn-sound-toggle');

  const screens = {
    home: document.getElementById('home-screen'),
    team: document.getElementById('team-screen'),
    prediction: document.getElementById('prediction-screen'),
    form: document.getElementById('form-screen'),
    pass: document.getElementById('pass-screen'),
    thankyou: document.getElementById('thankyou-screen')
  };

  const reservationOverlay = document.getElementById('reservation-overlay');
  const halftimeModal = document.getElementById('halftime-modal');

  const btnStartRsvp = document.getElementById('btn-start-rsvp');
  const btnPredictionContinue = document.getElementById('btn-prediction-continue');
  const rsvpForm = document.getElementById('rsvp-form');
  const btnSubmitRsvp = document.getElementById('btn-submit-rsvp');
  const formErrorBanner = document.getElementById('form-error-banner');

  const ticketGuestName = document.getElementById('ticket-guest-name');
  const ticketTeam = document.getElementById('ticket-team');
  const ticketPrediction = document.getElementById('ticket-prediction');
  const ticketGuests = document.getElementById('ticket-guests');
  const ticketResId = document.getElementById('ticket-res-id');
  const ticketQrImg = document.getElementById('ticket-qr-img');
  const ticketBadges = document.getElementById('ticket-badges');
  const fanPointsDisplay = document.getElementById('fan-points-display');
  const btnDownloadQr = document.getElementById('btn-download-qr');
  const referralLink = document.getElementById('referral-link');
  const btnCopyReferral = document.getElementById('btn-copy-referral');
  const leaderboardList = document.getElementById('leaderboard-list');
  const emailConfirmationNotice = document.getElementById('email-confirmation-notice');

  // ─── State ──────────────────────────────────────────────────────────────────
  const EVENT_DATE = new Date('2026-07-19T20:00:00+03:00');
  const POST_EVENT_DATE = new Date('2026-07-20T06:00:00+03:00');
  const HALFTIME_START = new Date('2026-07-19T21:30:00+03:00');
  const HALFTIME_END = new Date('2026-07-19T22:00:00+03:00');

  const userData = {
    team: '',
    scoreHome: 1,
    scoreAway: 0,
    goalScorer: '',
    fanPoints: 0,
    badges: [],
    reservationId: '',
    qrDataUrl: '',
    referralCode: ''
  };

  let currentReservationId = '';
  let currentQrDataUrl = '';
  let audioStarted = false;
  let soundEnabled = sessionStorage.getItem('soundEnabled') !== '0';

  function applySoundState() {
    const shouldMute = !soundEnabled;
    if (bgAudio) bgAudio.muted = shouldMute;
    if (loadingVideo) loadingVideo.muted = shouldMute;
    if (btnSoundToggle) {
      btnSoundToggle.classList.toggle('sound-off', !soundEnabled);
      btnSoundToggle.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Unmute sound');
      btnSoundToggle.setAttribute('aria-pressed', String(soundEnabled));
    }
  }

  applySoundState();

  // ─── 1. LOADING SCREEN ──────────────────────────────────────────────────────
  if (loadingVideo) {
    loadingVideo.volume = 0.7;
    loadingVideo.muted = !soundEnabled;
    loadingVideo.play().catch(() => {
      loadingVideo.muted = true;
      loadingVideo.play().catch(() => {});
    });
  }

  setTimeout(() => {
    if (loadingVideo) {
      loadingVideo.pause();
    }
    loadingScreen.classList.add('fade-out');
    appContainer.classList.remove('hidden');
    startAmbientMusic();

    setTimeout(() => {
      loadingScreen.style.display = 'none';
      initPostLoading();
    }, 1000);
  }, 8500);

  function initPostLoading() {
    if (new Date() >= POST_EVENT_DATE) {
      switchScreen(null, screens.thankyou);
      loadLeaderboard(document.getElementById('final-leaderboard'));
      return;
    }
    startCountdown();
    checkHalftime();
    setInterval(checkHalftime, 60000);
  }

  // ─── 2. AMBIENT MUSIC ───────────────────────────────────────────────────────
  function startAmbientMusic() {
    if (!bgAudio || audioStarted) return;
    bgAudio.volume = 0.25;
    bgAudio.muted = !soundEnabled;
    bgAudio.play().then(() => {
      audioStarted = true;
    }).catch(() => {
      document.addEventListener('click', tryPlayAudio, { once: true });
      document.addEventListener('touchstart', tryPlayAudio, { once: true });
    });
  }

  function tryPlayAudio() {
    if (!bgAudio || audioStarted) return;
    bgAudio.muted = !soundEnabled;
    bgAudio.play().then(() => { audioStarted = true; }).catch(() => {});
  }

  if (btnSoundToggle) {
    btnSoundToggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      sessionStorage.setItem('soundEnabled', soundEnabled ? '1' : '0');
      applySoundState();
      if (soundEnabled) {
        tryPlayAudio();
      } else if (bgAudio) {
        bgAudio.pause();
        audioStarted = false;
      }
    });
  }

  // ─── 3. COUNTDOWN TIMER ─────────────────────────────────────────────────────
  function startCountdown() {
    const els = {
      days: document.getElementById('cd-days'),
      hours: document.getElementById('cd-hours'),
      mins: document.getElementById('cd-mins'),
      secs: document.getElementById('cd-secs')
    };
    if (!els.days) return;

    function tick() {
      const diff = EVENT_DATE - new Date();
      if (diff <= 0) {
        els.days.textContent = '00';
        els.hours.textContent = '00';
        els.mins.textContent = '00';
        els.secs.textContent = '00';
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      els.days.textContent = String(d).padStart(2, '0');
      els.hours.textContent = String(h).padStart(2, '0');
      els.mins.textContent = String(m).padStart(2, '0');
      els.secs.textContent = String(s).padStart(2, '0');
    }
    tick();
    setInterval(tick, 1000);
  }

  // ─── 4. NAVIGATION ──────────────────────────────────────────────────────────
  function switchScreen(fromScreen, toScreen) {
    if (fromScreen) fromScreen.classList.remove('active');
    setTimeout(() => {
      Object.values(screens).forEach(s => s.classList.remove('active'));
      toScreen.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 150);
  }

  btnStartRsvp.addEventListener('click', () => {
    tryPlayAudio();
    switchScreen(screens.home, screens.team);
  });

  document.querySelectorAll('.back-link[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.back);
      const active = document.querySelector('.screen.active');
      if (target) switchScreen(active, target);
    });
  });

  // ─── 5. TEAM SELECTION ──────────────────────────────────────────────────────
  document.querySelectorAll('.team-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.team-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      userData.team = card.dataset.team;
      setTimeout(() => switchScreen(screens.team, screens.prediction), 400);
    });
  });

  // ─── 6. PREDICTION ──────────────────────────────────────────────────────────
  btnPredictionContinue.addEventListener('click', () => {
    userData.scoreHome = parseInt(document.getElementById('score-home').value, 10) || 0;
    userData.scoreAway = parseInt(document.getElementById('score-away').value, 10) || 0;
    userData.goalScorer = document.getElementById('goalScorer').value.trim();
    switchScreen(screens.prediction, screens.form);
  });

  // ─── 7. RSVP FORM ───────────────────────────────────────────────────────────
  rsvpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormErrors();
    formErrorBanner.classList.add('hidden');

    const formData = {
      name: document.getElementById('fullName').value.trim(),
      email: document.getElementById('emailAddress').value.trim(),
      phone: document.getElementById('phoneNumber').value.trim(),
      guestCount: parseInt(document.getElementById('guestCount').value, 10) || 1,
      team: userData.team,
      scoreHome: userData.scoreHome,
      scoreAway: userData.scoreAway,
      goalScorer: userData.goalScorer,
      referredBy: new URLSearchParams(window.location.search).get('ref') || ''
    };

    let hasError = false;
    if (!formData.name) { showInputError('fullName', 'Full Name is required.'); hasError = true; }
    if (!formData.phone) { showInputError('phoneNumber', 'Phone Number is required.'); hasError = true; }
    if (!formData.email) {
      showInputError('emailAddress', 'Email is required to receive your confirmation & QR code.'); hasError = true;
    } else if (!validateEmail(formData.email)) {
      showInputError('emailAddress', 'Please enter a valid email address.'); hasError = true;
    }
    if (!formData.team) {
      formErrorBanner.textContent = 'Please choose your team first.';
      formErrorBanner.classList.remove('hidden');
      switchScreen(screens.form, screens.team);
      return;
    }
    if (hasError) {
      formErrorBanner.textContent = 'Please fill out all required fields.';
      formErrorBanner.classList.remove('hidden');
      return;
    }

    setSubmitState(true);

    try {
      const apiPromise = fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const animationPromise = playReservationAnimation();
      const [response] = await Promise.all([apiPromise, animationPromise]);
      const result = await response.json();

      if (response.ok) {
        await showReservationSuccess();
        currentReservationId = result.reservationId;
        currentQrDataUrl = result.qrDataUrl;
        localStorage.setItem('lastReservationId', result.reservationId);
        userData.fanPoints = result.fanPoints || 200;
        userData.badges = result.badges || [];
        userData.referralCode = result.referralCode || '';

        renderMatchPass(formData, result);
        showEmailConfirmationNotice(result, formData);
        reservationOverlay.classList.add('hidden');
        switchScreen(screens.form, screens.pass);
        loadLeaderboard(leaderboardList);
      } else {
        reservationOverlay.classList.add('hidden');
        formErrorBanner.textContent = result.error || 'Registration failed.';
        formErrorBanner.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
      reservationOverlay.classList.add('hidden');
      formErrorBanner.textContent = 'Connection error. Please try again.';
      formErrorBanner.classList.remove('hidden');
    } finally {
      setSubmitState(false);
    }
  });

  // ─── 8. RESERVATION ANIMATION ───────────────────────────────────────────────
  function playReservationAnimation() {
    return new Promise(resolve => {
      reservationOverlay.classList.remove('hidden');
      const steps = reservationOverlay.querySelectorAll('.reservation-step');
      steps.forEach(s => s.classList.remove('active'));

      let step = 0;
      steps[0].classList.add('active');

      const interval = setInterval(() => {
        step++;
        if (step < steps.length - 1) {
          steps.forEach(s => s.classList.remove('active'));
          steps[step].classList.add('active');
        } else {
          clearInterval(interval);
          resolve();
        }
      }, 1200);
    });
  }

  function showReservationSuccess() {
    return new Promise(resolve => {
      const steps = reservationOverlay.querySelectorAll('.reservation-step');
      steps.forEach(s => s.classList.remove('active'));
      steps[steps.length - 1].classList.add('active');
      setTimeout(resolve, 800);
    });
  }

  // ─── 9. RENDER MATCH PASS ───────────────────────────────────────────────────
  function renderMatchPass(formData, result) {
    ticketGuestName.textContent = formData.name;
    ticketTeam.textContent = formData.team;
    ticketPrediction.textContent = `${formData.scoreHome} — ${formData.scoreAway}` +
      (formData.goalScorer ? ` · ${formData.goalScorer}` : '');
    ticketGuests.textContent = formData.guestCount;
    ticketResId.textContent = result.reservationId;
    ticketQrImg.src = result.qrDataUrl;
    ticketQrImg.alt = `QR code for reservation ${result.reservationId}`;
    fanPointsDisplay.textContent = result.fanPoints;

    ticketBadges.innerHTML = '';
    (result.badges || []).forEach(badge => {
      const span = document.createElement('span');
      span.className = 'badge-pill';
      span.textContent = badge;
      ticketBadges.appendChild(span);
    });

    if (referralLink) {
    const refUrl =
        `${window.location.origin}${window.location.pathname}?ref=${result.referralCode}`;
    referralLink.value = refUrl;
}
  }

  function showEmailConfirmationNotice(result, formData) {
    if (!emailConfirmationNotice) return;
    emailConfirmationNotice.classList.remove('hidden');
    if (result?.emailSent && formData?.email) {
      emailConfirmationNotice.textContent = `Confirmation email sent to ${formData.email} with your QR code and event details.`;
      emailConfirmationNotice.classList.remove('is-warning');
    } else {
      emailConfirmationNotice.textContent = 'A backup confirmation copy with your QR code was saved locally for your records.';
      emailConfirmationNotice.classList.add('is-warning');
    }
  }

  // ─── 10. REFERRAL COPY ──────────────────────────────────────────────────────
  if (btnCopyReferral && referralLink) {
    btnCopyReferral.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(referralLink.value);
            btnCopyReferral.textContent = 'Copied!';
            setTimeout(() => {
                btnCopyReferral.textContent = 'Copy Link';
            }, 2000);
        } catch {
            referralLink.select();
            document.execCommand('copy');
            btnCopyReferral.textContent = 'Copied!';
        }
    });
}

  // ─── 11. LEADERBOARD ────────────────────────────────────────────────────────
  async function loadLeaderboard(container) {
    if (!container) return;
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      if (!data.leaderboard || data.leaderboard.length === 0) {
        container.innerHTML = '<p class="muted">Be the first to register!</p>';
        return;
      }
      container.innerHTML = data.leaderboard.map((entry, i) => `
        <div class="leaderboard-row ${i < 3 ? 'top-' + (i + 1) : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${escapeHtml(entry.name)}</span>
          <span class="lb-points">${entry.fanPoints} pts</span>
        </div>
      `).join('');
    } catch {
      container.innerHTML = '<p class="muted">Leaderboard unavailable</p>';
    }
  }

  // ─── 12. HALFTIME PREDICTION ────────────────────────────────────────────────
  function checkHalftime() {
    const now = new Date();
    if (now >= HALFTIME_START && now <= HALFTIME_END && currentReservationId) {
      const dismissed = sessionStorage.getItem('halftime-dismissed');
      if (!dismissed) halftimeModal.classList.remove('hidden');
    }
  }

  document.getElementById('btn-close-halftime')?.addEventListener('click', () => {
    halftimeModal.classList.add('hidden');
    sessionStorage.setItem('halftime-dismissed', '1');
  });

  document.getElementById('btn-submit-halftime')?.addEventListener('click', async () => {
    const htHome = parseInt(document.getElementById('ht-score-home').value, 10) || 0;
    const htAway = parseInt(document.getElementById('ht-score-away').value, 10) || 0;
    const id = currentReservationId || localStorage.getItem('lastReservationId');
    if (!id) return;

    try {
      const res = await fetch(`/api/rsvp/${id}/halftime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoreHome: htHome, scoreAway: htAway })
      });
      const data = await res.json();
      if (res.ok) {
        fanPointsDisplay.textContent = data.fanPoints;
        halftimeModal.classList.add('hidden');
        alert('Halftime prediction submitted! +25 bonus points.');
      }
    } catch {
      alert('Could not submit prediction.');
    }
  });

  // ─── 13. DOWNLOAD QR ────────────────────────────────────────────────────────
  btnDownloadQr.addEventListener('click', () => {
    if (!currentQrDataUrl) return;
    const link = document.createElement('a');
    link.href = currentQrDataUrl;
    link.download = `Visa_CBE_MatchPass_${currentReservationId}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function validateEmail(email) {
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  }

  function showInputError(inputId, message) {
    const inputEl = document.getElementById(inputId);
    inputEl.parentElement.classList.add('invalid');
    const errorEl = document.getElementById(`err-${inputId}`);
    if (errorEl) errorEl.textContent = message;
  }

  function clearFormErrors() {
    rsvpForm.querySelectorAll('.input-group.invalid').forEach(g => g.classList.remove('invalid'));
    rsvpForm.querySelectorAll('.error-msg').forEach(m => m.textContent = '');
  }

  function setSubmitState(isLoading) {
    btnSubmitRsvp.disabled = isLoading;
    btnSubmitRsvp.querySelector('.btn-text').textContent =
      isLoading ? 'PROCESSING...' : 'RESERVE MY SEAT';
    btnSubmitRsvp.style.opacity = isLoading ? '0.7' : '1';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
