document.addEventListener('DOMContentLoaded', () => {
  // ─── Elements ───────────────────────────────────────────────────────────────
  const loadingScreen = document.getElementById('loading-screen');
  const loadingVideo = document.getElementById('loading-video');
  const appContainer = document.getElementById('app-container');

  const screens = {
    home: document.getElementById('home-screen'),
    form: document.getElementById('form-screen'),
    pass: document.getElementById('pass-screen')
  };

  const reservationOverlay = document.getElementById('reservation-overlay');

  const btnStartRsvp = document.getElementById('btn-start-rsvp');
  const rsvpForm = document.getElementById('rsvp-form');
  const btnSubmitRsvp = document.getElementById('btn-submit-rsvp');
  const formErrorBanner = document.getElementById('form-error-banner');

  const ticketGuestName = document.getElementById('ticket-guest-name');
  const ticketResId = document.getElementById('ticket-res-id');
  const ticketQrImg = document.getElementById('ticket-qr-img');
  const btnDownloadQr = document.getElementById('btn-download-qr');
  const emailConfirmationNotice = document.getElementById('email-confirmation-notice');

  // ─── State ──────────────────────────────────────────────────────────────────
  const EVENT_DATE = new Date('2026-07-19T20:00:00+03:00');

  let currentReservationId = '';
  let currentQrDataUrl = '';

  // ─── 1. LOADING SCREEN ──────────────────────────────────────────────────────
  if (loadingVideo) {
    loadingVideo.play().catch(() => {});
  }

  setTimeout(() => {
    if (loadingVideo) {
      loadingVideo.pause();
    }
    loadingScreen.classList.add('fade-out');
    appContainer.classList.remove('hidden');

    setTimeout(() => {
      loadingScreen.style.display = 'none';
      initPostLoading();
    }, 1000);
  }, 8500);

  function initPostLoading() {
    startCountdown();
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
    switchScreen(screens.home, screens.form);
  });

  document.querySelectorAll('.back-link[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.back);
      const active = document.querySelector('.screen.active');
      if (target) switchScreen(active, target);
    });
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
      organization: document.getElementById('organization').value.trim(),
      guestCount: 1,
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

        renderMatchPass(formData, result);
        showEmailConfirmationNotice(result, formData);
        reservationOverlay.classList.add('hidden');
        switchScreen(screens.form, screens.pass);
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
    ticketResId.textContent = result.reservationId;
    ticketQrImg.src = result.qrDataUrl;
    ticketQrImg.alt = `QR code for reservation ${result.reservationId}`;
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
});
