document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const manualIdInput = document.getElementById('manual-id-input');
  const btnManualLookup = document.getElementById('btn-manual-lookup');
  const btnToggleCamera = document.getElementById('btn-toggle-camera');

  const stateEmpty = document.getElementById('state-empty');
  const stateLoading = document.getElementById('state-loading');
  const stateError = document.getElementById('state-error');
  const stateFoundClean = document.getElementById('state-found-clean');
  const stateFoundAlready = document.getElementById('state-found-already');

  const errorMessageText = document.getElementById('error-message-text');

  // Clean elements
  const valCleanName = document.getElementById('val-clean-name');
  const valCleanOrg = document.getElementById('val-clean-org');
  const valCleanId = document.getElementById('val-clean-id');
  const valCleanMeal = document.getElementById('val-clean-meal');
  const valCleanReqs = document.getElementById('val-clean-reqs');
  const btnPerformCheckin = document.getElementById('btn-perform-checkin');

  // Duplicate elements
  const valDupName = document.getElementById('val-dup-name');
  const valDupOrg = document.getElementById('val-dup-org');
  const valDupId = document.getElementById('val-dup-id');
  const valDupTime = document.getElementById('val-dup-time');

  // New Directory UI Elements
  const directorySearch = document.getElementById('directory-search');
  const directoryFilter = document.getElementById('directory-filter');
  const directoryList = document.getElementById('guest-directory-list');
  const statTotal = document.getElementById('stat-total');
  const statChecked = document.getElementById('stat-checked');

  const btnResetViews = document.querySelectorAll('.btn-reset-view, .btn-reset-view-secondary');

  // State Variables
  let currentGuest = null;
  let qrScanner = null;
  let isScannerRunning = false;
  let guestDatabaseList = []; // Local mirror of DB reservations for list search/filter

  // ==========================================
  // 1. STATE SWITCHING LOGIC
  // ==========================================
  function showState(activeStateView) {
    const states = [stateEmpty, stateLoading, stateError, stateFoundClean, stateFoundAlready];
    states.forEach(state => {
      if (state === activeStateView) {
        state.classList.add('active');
      } else {
        state.classList.remove('active');
      }
    });
  }

  // Reset to empty state
  function resetVerificationView() {
    currentGuest = null;
    manualIdInput.value = '';
    showState(stateEmpty);
  }

  btnResetViews.forEach(btn => {
    btn.addEventListener('click', resetVerificationView);
  });

  // ==========================================
  // 2. BACKEND DATABASE FETCHES
  // ==========================================
  
  // Fetch full list from API to populate directory
  async function fetchGuestDirectory() {
    try {
      const response = await fetch('/api/rsvps'); // Expects an endpoint returning all RSVPs
      if (!response.ok) throw new Error('Failed to fetch RSVPs');
      const data = await response.json();
      
      // Handle either response structure: [guest1, guest2] or { success: true, rsvps: [...] }
      guestDatabaseList = Array.isArray(data) ? data : (data.rsvps || []);
      renderDirectory();
    } catch (err) {
      console.warn('Could not fetch guest directory list from database:', err);
    }
  }

  // Render list matching current search + filter
  function renderDirectory() {
    const searchVal = directorySearch.value.toLowerCase().trim();
    const filterVal = directoryFilter.value; // 'all', 'pending', 'checked-in'

    directoryList.innerHTML = '';
    let totalCount = guestDatabaseList.length;
    let checkedCount = 0;

    guestDatabaseList.forEach(guest => {
      const isChecked = guest.check_in_status === 'Checked In' || guest.checkInStatus === 'Checked In';
      if (isChecked) checkedCount++;

      // Search matching logic
      const matchesSearch = guest.name.toLowerCase().includes(searchVal) ||
                            guest.id.toLowerCase().includes(searchVal) ||
                            (guest.organization && guest.organization.toLowerCase().includes(searchVal));

      // Filter matching logic
      const matchesFilter = (filterVal === 'all') ||
                            (filterVal === 'pending' && !isChecked) ||
                            (filterVal === 'checked-in' && isChecked);

      if (matchesSearch && matchesFilter) {
        const li = document.createElement('li');
        li.className = 'guest-item';
        li.setAttribute('data-id', guest.id);

        const badgeClass = isChecked ? 'status-checked' : 'status-pending';
        const badgeText = isChecked ? 'Checked In' : 'Pending';

        li.innerHTML = `
          <div class="guest-item-info">
            <span class="guest-item-name">${guest.name}</span>
            <span class="guest-item-meta">${guest.organization || 'VIP'} · ${guest.id}</span>
          </div>
          <span class="list-badge ${badgeClass}">${badgeText}</span>
        `;

        // Click list item to trigger look up
        li.addEventListener('click', () => {
          lookupReservation(guest.id);
        });

        directoryList.appendChild(li);
      }
    });

    // Update the UI metrics counter
    statTotal.textContent = totalCount;
    statChecked.textContent = checkedCount;
  }

  // Lookup reservation logic (from QR or manual entry)
  async function lookupReservation(id) {
    if (!id) return;
    
    let cleanId = id.trim();
    
    // URL fallback parsing logic
    try {
      if (cleanId.startsWith('http://') || cleanId.startsWith('https://')) {
        const url = new URL(cleanId);
        const urlParams = new URLSearchParams(url.search);
        if (urlParams.has('id')) {
          cleanId = urlParams.get('id');
        } else {
          const segments = url.pathname.split('/');
          cleanId = segments[segments.length - 1];
        }
      }
    } catch (e) {
      console.warn('URL parsing failed, searching raw string instead', e);
    }
    
    cleanId = cleanId.toUpperCase();
    showState(stateLoading);

    try {
      const response = await fetch(`/api/rsvp/${cleanId}`);
      if (!response.ok) {
        if (response.status === 404) {
          errorMessageText.textContent = `Reservation ID "${cleanId}" could not be found in the database. Please check the ID and try again.`;
        } else {
          errorMessageText.textContent = 'Server returned an error. Please try again.';
        }
        showState(stateError);
        return;
      }

      const data = await response.json();
      currentGuest = data.rsvp;

      renderGuestDetails(currentGuest);

    } catch (err) {
      console.error('Lookup error:', err);
      errorMessageText.textContent = 'Network error: could not connect to server database.';
      showState(stateError);
    }
  }

  function renderGuestDetails(rsvp) {
    const isAlreadyCheckedIn = rsvp.check_in_status === 'Checked In' || rsvp.checkInStatus === 'Checked In';

    if (isAlreadyCheckedIn) {
      valDupName.textContent = rsvp.name;
      valDupOrg.textContent = rsvp.organization || '';
      valDupId.textContent = rsvp.id;
      valDupTime.textContent = rsvp.check_in_time || rsvp.checkInTime || 'N/A';
      
      showState(stateFoundAlready);
    } else {
      valCleanName.textContent = rsvp.name;
      valCleanOrg.textContent = rsvp.organization || '';
      valCleanId.textContent = rsvp.id;
      valCleanMeal.textContent = rsvp.meal_preference || rsvp.mealPreference || 'Standard Gourmet Menu';
      valCleanReqs.textContent = rsvp.special_requests || rsvp.specialRequests || 'None';
      
      btnPerformCheckin.disabled = false;
      btnPerformCheckin.textContent = 'Check In Guest';

      showState(stateFoundClean);
    }
  }

  // Handle database writing on Check-in click
  btnPerformCheckin.addEventListener('click', async () => {
    if (!currentGuest) return;

    btnPerformCheckin.disabled = true;
    btnPerformCheckin.textContent = 'Processing Check-in...';

    try {
      const response = await fetch(`/api/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: currentGuest.id })
      });

      const result = await response.json();

      if (response.ok) {
        // Update status info inside local cache
        currentGuest.check_in_status = 'Checked In';
        currentGuest.check_in_time = result.rsvp.check_in_time || result.rsvp.checkInTime;
        
        // Re-sync local directory lists with newest checkin values
        const matchedIndex = guestDatabaseList.findIndex(g => g.id === currentGuest.id);
        if (matchedIndex !== -1) {
          guestDatabaseList[matchedIndex].check_in_status = 'Checked In';
          guestDatabaseList[matchedIndex].check_in_time = currentGuest.check_in_time;
        }

        renderDirectory();
        renderGuestDetails(currentGuest);
      } else {
        alert(result.error || 'Check-in failed. Please try again.');
        btnPerformCheckin.disabled = false;
        btnPerformCheckin.textContent = 'Check In Guest';
      }
    } catch (err) {
      console.error('Checkin process error:', err);
      alert('Network error. Check-in not saved.');
      btnPerformCheckin.disabled = false;
      btnPerformCheckin.textContent = 'Check In Guest';
    }
  });

  // ==========================================
  // 3. EVENT LISTENERS & FILTERING
  // ==========================================
  directorySearch.addEventListener('input', renderDirectory);
  directoryFilter.addEventListener('change', renderDirectory);

  btnManualLookup.addEventListener('click', () => {
    const lookupId = manualIdInput.value.trim();
    if (lookupId) lookupReservation(lookupId);
  });

  manualIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const lookupId = manualIdInput.value.trim();
      if (lookupId) lookupReservation(lookupId);
    }
  });

  // ==========================================
  // 4. QR CAMERA SCANNER INITIALIZATION
  // ==========================================
  function startScanner() {
    try {
      qrScanner = new Html5Qrcode("qr-reader");
      const config = { 
        fps: 10, 
        qrbox: (width, height) => {
          const minDim = Math.min(width, height);
          const boxSize = Math.floor(minDim * 0.7);
          return { width: boxSize, height: boxSize };
        }
      };

      qrScanner.start(
        { facingMode: "environment" }, 
        config,
        (decodedText) => {
          lookupReservation(decodedText);
        },
        (errorMessage) => {}
      ).then(() => {
        isScannerRunning = true;
        btnToggleCamera.textContent = "Stop Scanner Camera";
        btnToggleCamera.style.background = "rgba(255, 23, 68, 0.1)";
        btnToggleCamera.style.borderColor = "var(--color-red)";
        btnToggleCamera.style.color = "var(--color-red)";
      }).catch(err => {
        console.error("Camera start failed:", err);
        initializeFullWidget();
      });
    } catch (e) {
      console.error("QR Scanner initialization error:", e);
    }
  }

  function stopScanner() {
    if (qrScanner && isScannerRunning) {
      qrScanner.stop().then(() => {
        isScannerRunning = false;
        btnToggleCamera.textContent = "Start Scanner Camera";
        btnToggleCamera.style.background = "transparent";
        btnToggleCamera.style.borderColor = "var(--border-color)";
        btnToggleCamera.style.color = "#a19bb8";
      }).catch(err => {
        console.error("Camera stop failed:", err);
      });
    }
  }

  btnToggleCamera.addEventListener('click', () => {
    if (isScannerRunning) {
      stopScanner();
    } else {
      startScanner();
    }
  });

  function initializeFullWidget() {
    const fallbackScanner = new Html5QrcodeScanner(
      "qr-reader", 
      { fps: 10, qrbox: 250, rememberLastUsedCamera: true },
      false
    );
    fallbackScanner.render((decodedText) => {
      lookupReservation(decodedText);
    }, (error) => {});
  }

  // Initial runs
  fetchGuestDirectory();
  startScanner();
});