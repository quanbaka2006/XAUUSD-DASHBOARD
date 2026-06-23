const TelegramBot = require('node-telegram-bot-api');

let bot = null;
let _loadUsers = null;
let _saveUsers = null;
let _getDb = null;
let _getUseMongoDB = null;
let _vpsManager = null;
let _decryptPassword = null;
let _encryptPassword = null;
let _getSignals = null;
let _getCurrentPrices = null;
let _getTcpClients = null;
let _calculateCustomSlTp = null;

const SYMBOLS = {
  'XAUUSD': 'Vàng (XAU/USD)',
  'WTIUSD': 'Dầu (WTI/USD)',
  'XAGUSD': 'Bạc (XAG/USD)',
  'BTCUSD': 'Bitcoin (BTC/USD)',
  'ETHUSD': 'Ethereum (ETH/USD)'
};

// Conversational State Machine for users
const userStates = new Map();

function initTelegramBot(deps) {
  _loadUsers = deps.loadUsers;
  _saveUsers = deps.saveUsers;
  _getDb = deps.getDb;
  _getUseMongoDB = deps.getUseMongoDB;
  _vpsManager = deps.vpsManager;
  _decryptPassword = deps.decryptPassword;
  _encryptPassword = deps.encryptPassword;
  _getSignals = deps.getSignals;
  _getCurrentPrices = deps.getCurrentPrices;
  _getTcpClients = deps.getTcpClients;
  _calculateCustomSlTp = deps.calculateCustomSlTp;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram] No Bot Token provided. Bot is disabled.');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('[Telegram] Telegram Bot initialized with polling.');

  bot.on('message', async (msg) => {
    if (!msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      if (parts.length > 1) {
        const username = parts[1].trim().toLowerCase();
        await linkUser(username, chatId);
      } else {
        bot.sendMessage(chatId, `👋 *Chào mừng bạn đến với Alpha Gold!*\n\nĐể liên kết tài khoản, vui lòng truy cập Web lấy mã, hoặc gõ: \`/start <tên_đăng_nhập>\``, { parse_mode: 'Markdown' });
      }
      return;
    }

    const user = await getUserByChatId(chatId);
    if (!user) {
      if (!text.startsWith('/start')) {
        bot.sendMessage(chatId, `❌ Bạn chưa liên kết tài khoản. Vui lòng gõ \`/start <tên_đăng_nhập>\``, { parse_mode: 'Markdown' });
      }
      return;
    }

    const state = userStates.get(chatId);
    if (state) {
      if (state.step === 'ASK_MT5_ID') {
        state.mt5Id = text;
        state.step = 'ASK_MT5_PASS';
        bot.sendMessage(chatId, `Nhập **Mật khẩu** MT5 của tài khoản ${text}:`, { parse_mode: 'Markdown' });
        return;
      }
      if (state.step === 'ASK_MT5_PASS') {
        state.mt5Pass = text;
        state.step = 'ASK_MT5_SERVER';
        bot.sendMessage(chatId, `Nhập **Server** MT5 (vd: GTCGlobalSA-Server 2):`, { parse_mode: 'Markdown' });
        try { bot.deleteMessage(chatId, msg.message_id); } catch(e){}
        return;
      }
      if (state.step === 'ASK_MT5_SERVER') {
        const mt5Configs = user.mt5Configs || {};
        mt5Configs.id = state.mt5Id;
        // Encrypt the password before storing in users database
        mt5Configs.password = _encryptPassword ? _encryptPassword(state.mt5Pass) : state.mt5Pass;
        mt5Configs.server = text;
        
        await updateUser(user.username, { mt5Configs });
        userStates.delete(chatId);
        bot.sendMessage(chatId, `✅ Cấu hình MT5 thành công!\nID: ${state.mt5Id}\nServer: ${text}`, { parse_mode: 'Markdown' });
        sendMainMenu(chatId);
        return;
      }
      
      if (state.step === 'ASK_VOLUME') {
        const vol = parseFloat(text);
        if (isNaN(vol) || vol <= 0) {
          bot.sendMessage(chatId, `❌ Volume không hợp lệ. Vui lòng nhập lại (vd: 0.05):`);
          return;
        }
        await updateBotSetting(user.username, state.symbol, 'volume', vol);
        userStates.delete(chatId);
        bot.sendMessage(chatId, `✅ Đã lưu Volume = ${vol} lot cho ${SYMBOLS[state.symbol]}.`);
        sendBotMenu(chatId, state.symbol, await getUserByChatId(chatId));
        return;
      }
      if (state.step === 'ASK_TP') {
        const tp = parseFloat(text);
        if (isNaN(tp) || tp <= 0) {
          bot.sendMessage(chatId, `❌ TP không hợp lệ. Vui lòng nhập lại (vd: 50):`);
          return;
        }
        await updateBotSetting(user.username, state.symbol, 'tp', tp);
        userStates.delete(chatId);
        bot.sendMessage(chatId, `✅ Đã lưu TP = ${tp} cho ${SYMBOLS[state.symbol]}.`);
        sendBotMenu(chatId, state.symbol, await getUserByChatId(chatId));
        return;
      }
      if (state.step === 'ASK_SL') {
        const sl = parseFloat(text);
        if (isNaN(sl) || sl <= 0) {
          bot.sendMessage(chatId, `❌ SL không hợp lệ. Vui lòng nhập lại (vd: 30):`);
          return;
        }
        await updateBotSetting(user.username, state.symbol, 'sl', sl);
        userStates.delete(chatId);
        bot.sendMessage(chatId, `✅ Đã lưu SL = ${sl} cho ${SYMBOLS[state.symbol]}.`);
        sendBotMenu(chatId, state.symbol, await getUserByChatId(chatId));
        return;
      }
    }

    sendMainMenu(chatId);
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = await getUserByChatId(chatId);
    if (!user) return;

    if (data === 'menu_main') {
      sendMainMenu(chatId, query.message.message_id);
    } else if (data === 'config_mt5') {
      userStates.set(chatId, { step: 'ASK_MT5_ID' });
      bot.sendMessage(chatId, `Vui lòng nhập **ID MT5** của bạn:`, { parse_mode: 'Markdown' });
    } else if (data === 'select_bot') {
      const opts = {
        reply_markup: {
          inline_keyboard: Object.keys(SYMBOLS).map(sym => [{ text: SYMBOLS[sym], callback_data: `bot_${sym}` }])
        }
      };
      bot.editMessageText(`🤖 *CHỌN BOT TÍN HIỆU:*\n\nVui lòng chọn loại tài sản bạn muốn Bot tự động giao dịch:`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...opts
      });
    } else if (data.startsWith('bot_')) {
      const symbol = data.replace('bot_', '');
      sendBotMenu(chatId, symbol, user, query.message.message_id);
    } else if (data.startsWith('set_vol_')) {
      const symbol = data.replace('set_vol_', '');
      userStates.set(chatId, { step: 'ASK_VOLUME', symbol });
      bot.sendMessage(chatId, `Nhập **Volume (Lot)** cho ${SYMBOLS[symbol]} (vd: 0.05):`, { parse_mode: 'Markdown' });
    } else if (data.startsWith('set_tp_')) {
      const symbol = data.replace('set_tp_', '');
      userStates.set(chatId, { step: 'ASK_TP', symbol });
      bot.sendMessage(chatId, `Nhập khoảng cách **Take Profit (Points)** cho ${SYMBOLS[symbol]} (vd: 50):`, { parse_mode: 'Markdown' });
    } else if (data.startsWith('set_sl_')) {
      const symbol = data.replace('set_sl_', '');
      userStates.set(chatId, { step: 'ASK_SL', symbol });
      bot.sendMessage(chatId, `Nhập khoảng cách **Stop Loss (Points)** cho ${SYMBOLS[symbol]} (vd: 30):`, { parse_mode: 'Markdown' });
    } else if (data.startsWith('enable_bot_')) {
      const symbol = data.replace('enable_bot_', '');
      await updateBotSetting(user.username, symbol, 'enabled', true);
      bot.answerCallbackQuery(query.id, { text: `Đã BẬT nhận tín hiệu cho ${symbol}` });
      sendBotMenu(chatId, symbol, await getUserByChatId(chatId), query.message.message_id);
      return;
    } else if (data.startsWith('disable_bot_')) {
      const symbol = data.replace('disable_bot_', '');
      await updateBotSetting(user.username, symbol, 'enabled', false);
      bot.answerCallbackQuery(query.id, { text: `Đã TẮT nhận tín hiệu cho ${symbol}` });
      sendBotMenu(chatId, symbol, await getUserByChatId(chatId), query.message.message_id);
      return;
    } else if (data === 'start_vps') {
      bot.sendMessage(chatId, `🚀 Đang khởi chạy Hệ thống MT5 ngầm... Vui lòng đợi 10-15s.`);
      if (user.mt5Configs && user.mt5Configs.id) {
        let pass = user.mt5Configs.password;
        if (pass && _decryptPassword) {
          try {
            pass = _decryptPassword(pass);
          } catch (err) {
            // fallback if it was already plaintext
          }
        }
        const res = _vpsManager.startSlot(user.mt5Configs.id, pass, user.mt5Configs.server);
        if (res) {
          bot.sendMessage(chatId, `✅ Khởi chạy VPS thành công! Hệ thống đang chờ EA kết nối...`);
          await sendMainMenu(chatId, query.message.message_id);
        } else {
          bot.sendMessage(chatId, `❌ Lỗi khởi chạy VPS.`);
        }
      } else {
        bot.sendMessage(chatId, `❌ Bạn chưa cấu hình MT5. Vui lòng cấu hình trước.`);
      }
    } else if (data === 'stop_vps') {
      if (user.mt5Configs && user.mt5Configs.id) {
        _vpsManager.stopSlot(user.mt5Configs.id);
        bot.sendMessage(chatId, `🔴 Đã tắt hệ thống MT5 thành công.`);
        await sendMainMenu(chatId, query.message.message_id);
      }
    } else if (data === 'view_signals_list') {
      const opts = {
        reply_markup: {
          inline_keyboard: [
            ...Object.keys(SYMBOLS).map(sym => [{ text: SYMBOLS[sym], callback_data: `sig_sym_${sym}` }]),
            [{ text: '🔙 Quay lại', callback_data: 'menu_main' }]
          ]
        }
      };
      bot.editMessageText(`📊 *DANH SÁCH TÍN HIỆU LIVE*\n\nVui lòng chọn cặp tài sản để xem các tín hiệu mới nhất:`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...opts
      });
    } else if (data.startsWith('sig_sym_')) {
      const symbol = data.replace('sig_sym_', '');
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'M1', callback_data: `sig_tf_${symbol}_M1` }, { text: 'M5', callback_data: `sig_tf_${symbol}_M5` }],
            [{ text: 'M15', callback_data: `sig_tf_${symbol}_M15` }, { text: 'H1', callback_data: `sig_tf_${symbol}_H1` }],
            [{ text: '🔙 Quay lại', callback_data: 'view_signals_list' }]
          ]
        }
      };
      bot.editMessageText(`📊 *Khung thời gian cho ${SYMBOLS[symbol] || symbol}*\n\nVui lòng chọn khung thời gian muốn xem:`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        ...opts
      });
    } else if (data.startsWith('sig_tf_')) {
      const parts = data.replace('sig_tf_', '').split('_');
      const symbol = parts[0];
      const tf = parts[1];
      
      const signals = _getSignals ? _getSignals() : {};
      const signal = signals[symbol] && signals[symbol][tf];
      
      let text = `📊 *Chi tiết tín hiệu ${symbol} (${tf})*\n\n`;
      const inline_keyboard = [];

      if (!signal) {
        text += `❌ Hiện tại chưa có dữ liệu tín hiệu cho cặp tài sản và khung thời gian này.`;
        inline_keyboard.push([{ text: '🔙 Quay lại', callback_data: `sig_sym_${symbol}` }]);
      } else {
        const isStale = signal.action.toLowerCase() === 'stale';
        const actionText = isStale ? '⚪ KHÔNG CÓ (STALE)' : (signal.action.toUpperCase() === 'BUY' ? '🟢 MUA (BUY) 📈' : '🔴 BÁN (SELL) 📉');
        const ageSecs = Math.floor((Date.now() - signal.timestamp) / 1000);
        let ageText = '';
        if (ageSecs < 60) ageText = 'Vừa xong';
        else if (ageSecs < 3600) ageText = `${Math.floor(ageSecs / 60)} phút trước`;
        else ageText = `${Math.floor(ageSecs / 3600)} giờ trước`;

        text += `• Trạng thái: *${actionText}*\n` +
                `• Giá kích hoạt: *${signal.entry}*\n` +
                `• Stop Loss (SL): *${signal.sl || 'Không có'}*\n` +
                `• Take Profit (TP): *${signal.tp || 'Không có'}*\n` +
                `• Độ tin cậy: *${signal.confidence}%*\n` +
                `• Cập nhật: *${ageText}*\n\n`;

        const mt5Id = user.mt5Configs && user.mt5Configs.id;
        const isConnected = mt5Id && _getTcpClients ? _getTcpClients().has(String(mt5Id)) : false;

        if (!isStale) {
          text += `👉 Cài đặt giao dịch của bạn:\n` +
                  `- Khối lượng: *${(user.botSettings && user.botSettings[symbol] && user.botSettings[symbol].volume) || 0.01} lot*\n` +
                  `- SL: *${(user.botSettings && user.botSettings[symbol] && user.botSettings[symbol].sl) || 30} pts*\n` +
                  `- TP: *${(user.botSettings && user.botSettings[symbol] && user.botSettings[symbol].tp) || 50} pts*\n\n`;

          if (isConnected) {
            inline_keyboard.push([{ text: '📥 Vào lệnh ngay', callback_data: `exec_sig_${symbol}_${tf}` }]);
          } else {
            text += `⚠️ *Lưu ý*: VPS của bạn chưa hoạt động. Hãy khởi chạy VPS để có thể vào lệnh.\n\n`;
            inline_keyboard.push([{ text: '🚀 Khởi chạy MT5', callback_data: 'start_vps' }]);
          }
        }
        
        inline_keyboard.push([{ text: '🔙 Quay lại', callback_data: `sig_sym_${symbol}` }]);
      }

      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
    } else if (data.startsWith('exec_sig_')) {
      const parts = data.replace('exec_sig_', '').split('_');
      const symbol = parts[0];
      const tf = parts[1];
      await executeManualSignal(chatId, symbol, tf, query.id);
      return;
    }
    
    bot.answerCallbackQuery(query.id);
  });
}

async function sendMainMenu(chatId, messageId = null) {
  const user = await getUserByChatId(chatId);
  let statusText = '🔴 Trạng thái VPS: ĐÃ TẮT';
  if (user && user.mt5Configs && user.mt5Configs.id) {
    const status = _vpsManager.getSlotStatus(user.mt5Configs.id);
    if (status.running) {
      statusText = `🟢 Trạng thái VPS: ĐANG CHẠY (PID: ${status.pid})`;
    }
  }

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⚙️ Cấu hình MT5', callback_data: 'config_mt5' }],
        [{ text: '🤖 Chọn Bot & Thông số', callback_data: 'select_bot' }],
        [{ text: '📊 Tín hiệu mới nhất', callback_data: 'view_signals_list' }],
        [{ text: '🚀 Khởi chạy Bot', callback_data: 'start_vps' }, { text: '🔴 Tắt Bot', callback_data: 'stop_vps' }],
        [{ text: '🔄 Cập nhật trạng thái', callback_data: 'menu_main' }]
      ]
    }
  };

  const text = `*HỆ THỐNG ALPHA GOLD AUTO*\n\n${statusText}\n\nChọn chức năng bên dưới:`;
  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...opts });
    } catch (e) {
      try { bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts }); } catch (err){}
    }
  } else {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  }
}

function sendBotMenu(chatId, symbol, user, messageId = null) {
  const settings = (user.botSettings && user.botSettings[symbol]) || { volume: 0.01, tp: 50, sl: 30, enabled: false };
  const toggleText = settings.enabled ? `🟢 ĐANG BẬT (Bấm để Tắt)` : `🔴 ĐANG TẮT (Bấm để Bật)`;
  const toggleData = settings.enabled ? `disable_bot_${symbol}` : `enable_bot_${symbol}`;
  
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: toggleText, callback_data: toggleData }],
        [{ text: `Volume: ${settings.volume} lot`, callback_data: `set_vol_${symbol}` }],
        [{ text: `TP: ${settings.tp} points`, callback_data: `set_tp_${symbol}` }, { text: `SL: ${settings.sl} points`, callback_data: `set_sl_${symbol}` }],
        [{ text: '🔙 Quay lại', callback_data: 'select_bot' }]
      ]
    }
  };
  const text = `🤖 *Cấu hình Bot ${SYMBOLS[symbol]}*\n\nThiết lập hiện tại:\n- Trạng thái: ${settings.enabled ? 'ĐANG CHẠY' : 'ĐÃ DỪNG'}\n- Volume: ${settings.volume}\n- TP: ${settings.tp}\n- SL: ${settings.sl}`;
  
  if (messageId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...opts });
  } else {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
  }
}

async function linkUser(username, chatId) {
  let success = false;
  if (_getUseMongoDB()) {
    const res = await _getDb().collection('users').updateOne(
      { username: username },
      { $set: { telegramChatId: String(chatId) } }
    );
    success = res.matchedCount > 0;
  } else {
    const users = await _loadUsers();
    const idx = users.findIndex(u => u.username.toLowerCase() === username);
    if (idx !== -1) {
      users[idx].telegramChatId = String(chatId);
      await _saveUsers(users);
      success = true;
    }
  }

  if (success) {
    bot.sendMessage(chatId, `✅ Tài khoản *${username}* đã liên kết thành công!`, { parse_mode: 'Markdown' });
    sendMainMenu(chatId);
  } else {
    bot.sendMessage(chatId, `❌ Không tìm thấy user *${username}*.`, { parse_mode: 'Markdown' });
  }
}

async function getUserByChatId(chatId) {
  if (_getUseMongoDB()) {
    return await _getDb().collection('users').findOne({ telegramChatId: String(chatId) });
  } else {
    const users = await _loadUsers();
    return users.find(u => u.telegramChatId === String(chatId));
  }
}

async function updateUser(username, updates) {
  if (_getUseMongoDB()) {
    await _getDb().collection('users').updateOne({ username }, { $set: updates });
  } else {
    const users = await _loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx !== -1) {
      Object.assign(users[idx], updates);
      await _saveUsers(users);
    }
  }
}

async function updateBotSetting(username, symbol, key, value) {
  if (_getUseMongoDB()) {
    const updateObj = {};
    updateObj[`botSettings.${symbol}.${key}`] = value;
    await _getDb().collection('users').updateOne({ username }, { $set: updateObj });
  } else {
    const users = await _loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx !== -1) {
      if (!users[idx].botSettings) users[idx].botSettings = {};
      if (!users[idx].botSettings[symbol]) users[idx].botSettings[symbol] = { volume: 0.01, tp: 50, sl: 30, enabled: false };
      users[idx].botSettings[symbol][key] = value;
      await _saveUsers(users);
    }
  }
}

async function sendTelegramNotification(userId, message) {
  if (!bot) return;
  try {
    let chatId = null;
    if (_getUseMongoDB()) {
      const user = await _getDb().collection('users').findOne({ username: userId });
      if (user && user.telegramChatId) chatId = user.telegramChatId;
    } else {
      const users = await _loadUsers();
      const user = users.find(u => u.username.toLowerCase() === String(userId).toLowerCase());
      if (user && user.telegramChatId) chatId = user.telegramChatId;
    }
    
    if (!chatId && /^\d+$/.test(userId)) chatId = userId;
    if (!chatId) return;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[Telegram] Notification error:', e.message);
  }
}

async function executeManualSignal(chatId, symbol, tf, callbackQueryId) {
  const user = await getUserByChatId(chatId);
  if (!user) {
    bot.answerCallbackQuery(callbackQueryId, { text: '❌ Lỗi: Không tìm thấy tài khoản người dùng.' });
    return;
  }

  if (!user.mt5Configs || !user.mt5Configs.id) {
    bot.sendMessage(chatId, '❌ Bạn chưa cấu hình MT5. Vui lòng cấu hình trước.');
    bot.answerCallbackQuery(callbackQueryId);
    return;
  }

  const loginStr = String(user.mt5Configs.id);
  const tcpClients = _getTcpClients ? _getTcpClients() : null;
  const socket = tcpClients ? tcpClients.get(loginStr) : null;

  if (!socket) {
    bot.sendMessage(chatId, `🔴 VPS/MT5 của tài khoản *${loginStr}* chưa kết nối tới máy chủ.\nVui lòng bật VPS trước khi vào lệnh.`, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(callbackQueryId);
    return;
  }

  const signals = _getSignals ? _getSignals() : {};
  const signal = signals[symbol] && signals[symbol][tf];
  if (!signal) {
    bot.sendMessage(chatId, `❌ Không tìm thấy tín hiệu cho ${symbol} (${tf}).`);
    bot.answerCallbackQuery(callbackQueryId);
    return;
  }

  if (signal.action.toLowerCase() === 'stale') {
    bot.sendMessage(chatId, `⚠️ Tín hiệu ${symbol} (${tf}) đang ở trạng thái STALE (Không hoạt động).`);
    bot.answerCallbackQuery(callbackQueryId);
    return;
  }

  const userSettings = (user.botSettings && user.botSettings[symbol]) || { volume: 0.01, tp: 50, sl: 30 };
  const lotSize = userSettings.volume || 0.01;

  if (!_calculateCustomSlTp) {
    bot.sendMessage(chatId, `❌ Lỗi hệ thống: Hàm tính toán SL/TP chưa được khởi tạo.`);
    bot.answerCallbackQuery(callbackQueryId);
    return;
  }

  const { slPrice, tpPrice } = _calculateCustomSlTp(signal.action, signal.entry, userSettings.sl, userSettings.tp, symbol);

  console.log(`[Manual-Execution] User ${user.username} sending trade command to ${loginStr} - ${signal.action.toUpperCase()} ${symbol} ${lotSize} lot (SL: ${slPrice}, TP: ${tpPrice})`);
  
  try {
    socket.write(`TRADE|${signal.action.toUpperCase()}|${symbol}|${lotSize}|${signal.entry}|${slPrice || 0}|${tpPrice || 0}\n`);
    bot.answerCallbackQuery(callbackQueryId, { text: '📥 Đã gửi yêu cầu vào lệnh đến VPS!' });
    bot.sendMessage(chatId, 
      `📥 *ĐÃ GỬI YÊU CẦU VÀO LỆNH THỦ CÔNG*\n\n` +
      `• Tài khoản: MT5 - ${loginStr} (${user.name})\n` +
      `• Lệnh: *${signal.action.toUpperCase()} ${symbol}*\n` +
      `• Khối lượng: *${lotSize} lot*\n` +
      `• Giá SL: ${slPrice || 'Không có'} (cài đặt: ${userSettings.sl || 0} pts)\n` +
      `• Giá TP: ${tpPrice || 'Không có'} (cài đặt: ${userSettings.tp || 0} pts)\n` +
      `• Trạng thái: Đang đợi phản hồi từ MT5...`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Manual-Execution] Error sending trade command to socket:`, err.message);
    bot.sendMessage(chatId, `❌ Lỗi gửi lệnh giao dịch đến VPS: ${err.message}`);
    bot.answerCallbackQuery(callbackQueryId);
  }
}

async function broadcastManualSignalAlert(signal) {
  if (!bot) return;
  const { ticker, interval, action, entry, confidence } = signal;
  
  if (action.toLowerCase() === 'stale') return;

  try {
    let users = [];
    if (_getUseMongoDB()) {
      users = await _getDb().collection('users').find({ telegramChatId: { $exists: true, $ne: null } }).toArray();
    } else {
      const dbUsers = await _loadUsers();
      users = dbUsers.filter(u => u.telegramChatId);
    }

    const actionText = action.toUpperCase() === 'BUY' ? '🟢 MUA (BUY)' : '🔴 BÁN (SELL)';
    const emoji = action.toUpperCase() === 'BUY' ? '📈' : '📉';

    for (const user of users) {
      const userSettings = user.botSettings && user.botSettings[ticker];
      const isAutoEnabled = userSettings && userSettings.enabled;

      if (!isAutoEnabled) {
        const chatId = user.telegramChatId;
        const mt5Id = user.mt5Configs && user.mt5Configs.id;
        const isConnected = mt5Id && _getTcpClients ? _getTcpClients().has(String(mt5Id)) : false;
        
        const statusIcon = isConnected ? '🟢 VPS: SẴN SÀNG' : '🔴 VPS: CHƯA KẾT NỐI';
        
        const message = 
          `🚨 *TÍN HIỆU MỚI XUẤT HIỆN* 🚨\n\n` +
          `• Cặp tài sản: *${SYMBOLS[ticker] || ticker}*\n` +
          `• Khung thời gian: *${interval}*\n` +
          `• Khuyến nghị: *${actionText}* ${emoji}\n` +
          `• Giá kích hoạt: *${entry}*\n` +
          `• Độ tin cậy (Confidence): *${confidence}%*\n` +
          `• ${statusIcon}\n\n` +
          `Bạn có muốn thực hiện lệnh này ngay lập tức với cài đặt cá nhân của bạn không?`;

        const inline_keyboard = [];
        if (isConnected) {
          inline_keyboard.push([{ text: '📥 Vào lệnh theo tín hiệu', callback_data: `exec_sig_${ticker}_${interval}` }]);
        } else {
          inline_keyboard.push([{ text: '🚀 Khởi chạy MT5', callback_data: 'start_vps' }]);
        }
        inline_keyboard.push([{ text: '📊 Xem chi tiết tín hiệu', callback_data: `sig_tf_${ticker}_${interval}` }]);

        await bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard }
        });
      }
    }
  } catch (err) {
    console.error('[Telegram] Error broadcasting manual signal alert:', err.message);
  }
}

module.exports = { initTelegramBot, sendTelegramNotification, broadcastManualSignalAlert };
