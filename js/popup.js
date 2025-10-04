(function () {
  const elements = {};
  let feedbackTimer = null;
  let port = null;

  function cacheElements() {
    elements.body = document.body;
    elements.loader = document.getElementById('loader');
    elements.activateCheckbox = document.getElementById('active_app');
    elements.prepareCheckbox = document.getElementById('prepare_bet');
    elements.proxySettingsButton = document.getElementById('proxy_settings');
    elements.separateWindowButton = document.getElementById('separate_window');
    elements.proxyModal = document.getElementById('proxy_modal');
    elements.proxyModalClose = elements.proxyModal?.querySelector('.close');
    elements.proxyProtocol = document.getElementById('proxy_protocol');
    elements.proxyIp = document.getElementById('proxy_ip');
    elements.proxyPort = document.getElementById('proxy_port');
    elements.proxyUser = document.getElementById('proxy_user');
    elements.proxyPassword = document.getElementById('proxy_pwd');
    elements.placeButton = document.getElementById('place_bet');
    elements.betCoupon = document.getElementById('bet_coupon');
    elements.dangerIndicator = document.querySelector('#danger_indicator .indicator');
    elements.dangerCommand = document.querySelector('#danger_indicator .command');
    elements.licenseId = document.querySelector('#license_data .id');
    elements.licenseDate = document.querySelector('#license_data .date');
    elements.licenseVersion = document.querySelector('#license_data .version');
    elements.connectionIndicator = document.querySelector('#license_data .status .indicator');
    elements.content = document.querySelector('main .content');
    elements.feedback = document.createElement('div');
    elements.feedback.id = 'feedback';
    elements.feedback.setAttribute('role', 'status');
    if (elements.content) {
      elements.content.insertBefore(elements.feedback, elements.betCoupon);
    }
  }

  function connectPort() {
    port = chrome.runtime.connect({ name: 'popup' });
    port.onMessage.addListener(message => {
      if (message?.type === 'stateUpdate') {
        applyState(message.state);
      }
    });
  }

  function sendCommand(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        if (!response) {
          reject(new Error('No response from background script.'));
          return;
        }

        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Unexpected extension error.'));
        }
      });
    });
  }

  function setLoader(isLoading) {
    if (elements.loader) {
      elements.loader.classList.toggle('active', Boolean(isLoading));
    }
    if (elements.placeButton) {
      elements.placeButton.classList.toggle('betten', Boolean(isLoading));
    }
  }

  function showFeedback(message, type = 'info') {
    if (!elements.feedback) {
      return;
    }

    elements.feedback.textContent = message;
    elements.feedback.className = `visible ${type}`.trim();

    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
    }

    feedbackTimer = setTimeout(() => {
      elements.feedback.className = '';
      elements.feedback.textContent = '';
    }, 5000);
  }

  function escapeHtml(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toFixed(2) : '0.00';
  }

  function formatDate(isoString) {
    try {
      const date = new Date(isoString);
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      return isoString;
    }
  }

  function renderBetHistory(history) {
    if (!elements.betCoupon) {
      return;
    }

    if (!Array.isArray(history) || history.length === 0) {
      elements.betCoupon.innerHTML = '<div class="coupon empty">No bets placed yet.</div>';
      return;
    }

    const coupons = history
      .map((bet, index) => {
        const odds = formatNumber(bet.price);
        const stake = formatNumber(bet.stake);
        const placedAt = formatDate(bet.createdAt);
        const mode = bet.mode === 'danger' ? 'Danger mode' : 'Instant mode';
        const prepared = bet.prepared ? 'Warm-up enabled' : 'Warm-up disabled';
        const couponBody = `
          <div class="coupon">
            <div>
              <div class="label">${escapeHtml(bet.id || `Bet #${index + 1}`)}</div>
              <div class="event">${escapeHtml(placedAt)}</div>
              <div class="market">${escapeHtml(bet.market || 'Custom market')}</div>
              <div class="event">${escapeHtml(mode)} · ${escapeHtml(prepared)}</div>
            </div>
            <div>
              <div class="label">STAKE</div>
              <div class="price">${escapeHtml(stake)} ${escapeHtml(bet.currency || '')}</div>
              <div class="label">ODDS</div>
              <div class="price">${escapeHtml(odds)}</div>
            </div>
          </div>
        `;
        return couponBody.trim();
      })
      .join('<hr>');

    elements.betCoupon.innerHTML = coupons;
  }

  function applyState(state) {
    if (elements.activateCheckbox) {
      elements.activateCheckbox.checked = Boolean(state.appActive);
      elements.activateCheckbox.disabled = Boolean(state.isProcessing);
    }

    if (elements.prepareCheckbox) {
      elements.prepareCheckbox.checked = Boolean(state.prepareBet);
      elements.prepareCheckbox.disabled = Boolean(state.isProcessing && !state.prepareBet);
    }

    if (elements.loader) {
      elements.loader.classList.toggle('active', Boolean(state.isProcessing));
    }

    if (elements.placeButton) {
      elements.placeButton.disabled = !state.appActive || Boolean(state.isProcessing);
      elements.placeButton.classList.toggle('betten', Boolean(state.isProcessing));
      elements.placeButton.textContent = state.isProcessing
        ? 'Processing…'
        : state.appActive
        ? 'Place bet'
        : 'Activate the app to bet';
    }

    const radios = document.querySelectorAll('input[name="prep_type"]');
    radios.forEach(radio => {
      radio.checked = radio.value === state.prepType;
      radio.disabled = Boolean(state.isProcessing);
    });

    if (elements.dangerIndicator) {
      elements.dangerIndicator.classList.toggle('active', Boolean(state.danger?.safe));
      elements.dangerIndicator.title = state.danger?.label || '';
    }

    if (elements.dangerCommand) {
      elements.dangerCommand.textContent = state.danger?.command || 'Awaiting activation';
    }

    if (elements.licenseId) {
      elements.licenseId.textContent = `ID: ${state.license?.id || 'N/A'}`;
    }

    if (elements.licenseDate) {
      elements.licenseDate.textContent = `Expires: ${state.license?.expiresAt || 'Unlimited'}`;
    }

    if (elements.licenseVersion) {
      elements.licenseVersion.textContent = `Version: ${state.version}`;
    }

    if (elements.connectionIndicator) {
      elements.connectionIndicator.classList.toggle('active', state.connectionStatus === 'connected');
      elements.connectionIndicator.title = state.connectionStatus === 'connected' ? 'Connected' : 'Disconnected';
    }

    if (elements.proxyProtocol && state.proxy?.protocol) {
      elements.proxyProtocol.value = state.proxy.protocol;
    }

    if (elements.proxyIp) {
      elements.proxyIp.value = state.proxy?.ip || '';
    }

    if (elements.proxyPort) {
      elements.proxyPort.value = state.proxy?.port || '';
    }

    if (elements.proxyUser) {
      elements.proxyUser.value = state.proxy?.user || '';
    }

    if (elements.proxyPassword) {
      elements.proxyPassword.value = state.proxy?.password || '';
    }

    renderBetHistory(state.betHistory);

    if (elements.body && !elements.body.classList.contains('loaded')) {
      elements.body.classList.add('loaded');
    }
  }

  function handleProxyChange() {
    const payload = {
      protocol: elements.proxyProtocol?.value || 'http',
      ip: elements.proxyIp?.value?.trim() || '',
      port: elements.proxyPort?.value?.trim() || '',
      user: elements.proxyUser?.value?.trim() || '',
      password: elements.proxyPassword?.value?.trim() || ''
    };

    sendCommand('updateProxy', payload)
      .then(() => {
        showFeedback('Proxy settings saved.', 'success');
      })
      .catch(error => {
        console.error(error);
        showFeedback(error.message, 'error');
      });
  }

  function openProxyModal() {
    elements.proxyModal?.classList.add('active');
  }

  function closeProxyModal() {
    elements.proxyModal?.classList.remove('active');
  }

  function handleActivateChange(event) {
    const checked = event.target.checked;
    setLoader(true);
    sendCommand('toggleApp', { active: checked })
      .then(() => {
        showFeedback(checked ? 'Automation activated.' : 'Automation deactivated.', 'success');
      })
      .catch(error => {
        console.error(error);
        if (elements.activateCheckbox) {
          elements.activateCheckbox.checked = !checked;
        }
        showFeedback(error.message, 'error');
      })
      .finally(() => {
        setLoader(false);
      });
  }

  function handlePrepareChange(event) {
    const enabled = event.target.checked;
    sendCommand('setPrepareBet', { enabled })
      .then(() => {
        showFeedback(enabled ? 'Warm-up enabled.' : 'Warm-up disabled.', 'success');
      })
      .catch(error => {
        console.error(error);
        if (elements.prepareCheckbox) {
          elements.prepareCheckbox.checked = !enabled;
        }
        showFeedback(error.message, 'error');
      });
  }

  function handlePrepTypeChange(event) {
    if (!event.target.checked) {
      return;
    }
    const type = event.target.value;
    sendCommand('setPrepType', { type })
      .then(() => {
        showFeedback(`Mode switched to ${type === 'danger' ? 'danger' : 'instant'} mode.`, 'success');
      })
      .catch(error => {
        console.error(error);
        showFeedback(error.message, 'error');
      });
  }

  function handlePlaceBet() {
    setLoader(true);
    sendCommand('placeBet', { origin: 'popup' })
      .then(result => {
        showFeedback(`Bet ${result.id} placed successfully.`, 'success');
      })
      .catch(error => {
        console.error(error);
        showFeedback(error.message, 'error');
      })
      .finally(() => {
        setLoader(false);
      });
  }

  function openSeparateWindow() {
    sendCommand('openSeparateWindow')
      .then(() => {
        showFeedback('Opened standalone window.', 'success');
      })
      .catch(error => {
        console.error(error);
        showFeedback(error.message, 'error');
      });
  }

  function bindEvents() {
    elements.activateCheckbox?.addEventListener('change', handleActivateChange);
    elements.prepareCheckbox?.addEventListener('change', handlePrepareChange);
    document.querySelectorAll('input[name="prep_type"]').forEach(radio => {
      radio.addEventListener('change', handlePrepTypeChange);
    });

    elements.placeButton?.addEventListener('click', handlePlaceBet);
    elements.proxySettingsButton?.addEventListener('click', openProxyModal);
    elements.proxyModalClose?.addEventListener('click', closeProxyModal);
    elements.proxyModal?.addEventListener('click', event => {
      if (event.target === elements.proxyModal) {
        closeProxyModal();
      }
    });

    [
      elements.proxyProtocol,
      elements.proxyIp,
      elements.proxyPort,
      elements.proxyUser,
      elements.proxyPassword
    ].forEach(input => {
      input?.addEventListener('change', handleProxyChange);
    });

    elements.separateWindowButton?.addEventListener('click', openSeparateWindow);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeProxyModal();
      }
    });
  }

  function requestInitialState() {
    sendCommand('getState')
      .then(state => {
        applyState(state);
      })
      .catch(error => {
        console.error(error);
        showFeedback(error.message, 'error');
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    connectPort();
    bindEvents();
    requestInitialState();
  });
})();
