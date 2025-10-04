// Background script for a betting automation extension

// Configuration and state variables
let settings = null;
let coupon = null;
let betten = false;
let prepare_stop = null;
let bet_errors = [];
let api_socket = null;
let api_socket_reconn = null;
let api_socket_checkconn = null;
let api_socket_lastconn = null;
let session_interval = null;

// Initialize when document is loaded
document.addEventListener('DOMContentLoaded', async () => {
  await deactivateApp();
});

// Verify license token with server
async function verifyToken(token) {
  try {
    const requestData = {
      token: token,
      app: chrome.runtime.getManifest().name
    };

    const response = await fetch('https://service.fx.ru/api/license/verify', {
      method: 'POST',
      body: stringToHex(JSON.stringify(requestData))
    });

    if (response.ok) {
      const result = await response.json();
      if (!result.success) {
        return { success: false, error: result.error };
      } else {
        return {
          success: true,
          license_end: result.license_end,
          license_id: String(result.license_id)
        };
      }
    } else {
      return {
        success: false,
        error: `License verification failed. Response status: ${response.status}`
      };
    }
  } catch (error) {
    console.error(error);
    return { success: false, error: `Verification error: ${error.message}` };
  }
}

// Create a session with the betting server
async function createSession() {
  try {
    const sessionData = {
      countryCode: 'BR',
      culture: 'pt-BR',
      timezoneOffset: new Date().getTimezoneOffset(),
      integration: 'desktop',
      deviceType: 1,
      numFormat: 'x.x',
      token: settings.token,
      walletCode: settings.walletCode
    };

    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json'
    };

    const response = await fetch('https://srv.betfair.com/rest/v1/session', {
      headers: headers,
      body: JSON.stringify(sessionData),
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        sessionToken: result.sessionToken,
        currency: result.currency
      };
    } else {
      console.error(response.status);
      return {
        success: false,
        error: `Session creation failed. Status: ${response.status}`
      };
    }
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
}

// Place a bet
async function createBet() {
  try {
    // Prepare bet data
    const betData = {
      betMarkets: coupon,
      betType: coupon.length === 1 ? 0 : 1,
      confirmedByClient: false,
      countryCode: 'BR',
      culture: 'pt-BR',
      device: 0,
      deviceType: 1,
      eachWays: [false],
      integration: 'desktop',
      isAutoCharge: false,
      numFormat: 'x.x',
      oddsChangeAction: 2,
      requestId: makeid(20),
      stakes: [Number((settings.stake * getRandomFloat(0.1, 0.9, 2)).toFixed(2))],
      timezoneOffset: new Date().getTimezoneOffset()
    };

    const headers = {
      'accept': 'application/json',
      'authorization': `Bearer ${settings.token}`,
      'content-type': 'application/json'
    };

    const response = await fetch('https://srv.betfair.com/rest/v1/budget/placebet', {
      headers: headers,
      body: JSON.stringify(betData),
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Bet response:', result);

      if (result.error !== undefined) {
        // Handle different error types
        let errorMsg = '';
        
        switch (result.error.errorType) {
          case 1:
            errorMsg = 'Insufficient funds';
            break;
          case 2:
            errorMsg = 'Odds have changed';
            break;
          case 3:
            errorMsg = 'Market suspended';
            break;
          case 4:
            errorMsg = 'Account limited';
            break;
          default:
            errorMsg = `Betting error: ${result.error.message}`;
        }
        
        bet_errors.push(errorMsg);
        bet_errors = Array.from(new Set(bet_errors));
        
        return { success: false };
      } else {
        return { success: true };
      }
    } else {
      await sendNotification(
        'Betting Error', 
        `Failed to place bet. Status: ${response.status}`
      );
      await globalStop();
      return { success: false };
    }
  } catch (error) {
    await sendNotification(
      'Betting Error', 
      `Error placing bet: ${error.message}`
    );
    await globalStop();
    return { success: false };
  }
}

// Generate random ID
function makeid(length) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  
  return result;
}

// Compare server coupon with local
async function compareServerCoupon() {
  let serverCoupons = [];
  let localCoupon = await getValue('coupon');
  
  localCoupon.forEach(coupon => {
    let couponData = {
      game: coupon.gameName,
      market: `${coupon.odds[0].marketName}: ${coupon.odds[0].selectionName}`,
      odd: coupon.odds[0].price
    };
    serverCoupons.push(couponData);
  });
  
  return serverCoupons;
}

// Send notification
async function sendNotification(title, message) {
  console.log(title, message);
  
  if (title === 'Bet Placed') {
    const betData = {
      type: 'bet',
      amount: Number((settings.stake * getRandomFloat(0.1, 0.9, 2)).toFixed(2)),
      currency: settings.currency,
      coupons: await compareServerCoupon()
    };
    
    if (api_socket && api_socket.readyState === 1) {
      api_socket.send(stringToHex(JSON.stringify(betData)));
    }
    
    setTimeout(() => updateData(), 5000);
  }
  
  const notificationData = {
    action: 'notification',
    title: title,
    message: message
  };
  
  if (api_socket && api_socket.readyState === 1) {
    api_socket.send(stringToHex(JSON.stringify(notificationData)));
  }
  
  const notificationOptions = {
    type: 'basic',
    iconUrl: 'images/icon.png',
    title: title,
    message: message,
    priority: 2
  };
  
  chrome.notifications.create('', notificationOptions, () => {
    // Play sound based on notification type
    let sound = '';
    switch (title) {
      case 'Bet Placed':
        sound = 'sounds/bet.mp3';
        break;
      case 'Error':
        sound = 'sounds/error.mp3';
        break;
      default:
        sound = 'sounds/notification.mp3';
    }
    
    const audio = new Audio(chrome.runtime.getURL(sound));
    audio.volume = 0.7;
    audio.play();
  });
}

// Get account balance
async function getBalance() {
  try {
    const response = await fetch(`https://${settings.host}/api/balance`);
    
    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        balance: result.balance.available.amount
      };
    } else {
      console.error(response.status);
      return {
        success: false,
        error: `Balance check failed. Status: ${response.status}`
      };
    }
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
}

// Get account name/email
async function getAccountName() {
  try {
    const response = await fetch(`https://${settings.host}/api/profile/getData`);
    
    if (response.ok) {
      const result = await response.json();
      return {
        success: true,
        email: result.email
      };
    } else {
      console.error(response.status);
      return {
        success: false,
        error: `Account info failed. Status: ${response.status}`
      };
    }
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
}

// Activate game
async function getGameActivate(gameId) {
  try {
    const requestData = {
      action: 'activate',
      command: 'start',
      game: gameId
    };
    
    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json'
    };
    
    const response = await fetch('https://service.turbogames.online/api/game/activate', {
      body: JSON.stringify(requestData),
      headers: headers,
      method: 'POST'
    });
    
    if (response.ok) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `Game activation failed. Status: ${response.status}`
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Utility function to convert string to hex
function stringToHex(str) {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16);
  }
  return hex;
}

// Utility function to get random float value
function getRandomFloat(min, max, decimals) {
  const str = (Math.random() * (max - min) + min).toFixed(decimals);
  return parseFloat(str);
}