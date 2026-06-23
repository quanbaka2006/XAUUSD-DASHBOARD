const https = require('https');

let ioInstance = null;
let dbInstance = null;
let useMongoDBInstance = false;

// Fallback in-memory stores if MongoDB is not connected
let memorySignals = [];
let memoryEvents = [];

// Helper to strip HTML tags and decode entities
function stripHtml(str) {
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

// Function to fetch HTML from public Telegram channel preview
function fetchChannelHTML() {
  return new Promise((resolve, reject) => {
    https.get('https://t.me/s/tinhieudep245', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let html = '';
      res.on('data', (chunk) => html += chunk);
      res.on('end', () => resolve(html));
    }).on('error', (err) => reject(err));
  });
}

// Parse message content and structure it
function parseMessage(id, text) {
  const cleanText = text.replace(/·/g, '').replace(/━━━━━━━━━━━━━━━━━━/g, '').trim();

  // 1. NEW SIGNAL
  if (cleanText.includes('TÍN HIỆU MỚI')) {
    const symbolMatch = cleanText.match(/Symbol:\s*(\S+)/i);
    const actionMatch = cleanText.match(/Lệnh:\s*(🟢|🔴)?\s*(BUY|SELL)/i);
    const entryMatch = cleanText.match(/Entry:\s*([\d\.]+)/i);
    const slMatch = cleanText.match(/SL:\s*([\d\.]+)/i);
    const tp1Match = cleanText.match(/TP1:\s*([\d\.]+)/i);
    const tp2Match = cleanText.match(/TP2:\s*([\d\.]+)/i);
    const tp3Match = cleanText.match(/TP3:\s*([\d\.]+)/i);
    const tp4Match = cleanText.match(/TP4:\s*([\d\.]+)/i);
    const tp5Match = cleanText.match(/TP5:\s*([\d\.]+)/i);
    const timeMatch = cleanText.match(/Báo lúc:\s*(.+?)(?=\n|$)/i);

    if (symbolMatch && actionMatch && entryMatch) {
      const action = actionMatch[2].trim().toLowerCase();
      const entry = parseFloat(entryMatch[1]);
      const sl = slMatch ? parseFloat(slMatch[1]) : null;
      const tps = [
        tp1Match ? parseFloat(tp1Match[1]) : null,
        tp2Match ? parseFloat(tp2Match[1]) : null,
        tp3Match ? parseFloat(tp3Match[1]) : null,
        tp4Match ? parseFloat(tp4Match[1]) : null,
        tp5Match ? parseFloat(tp5Match[1]) : null,
      ].filter(Boolean);

      return {
        type: 'SIGNAL_NEW',
        id: parseInt(id),
        symbol: symbolMatch[1].trim(),
        action: action,
        entry: entry,
        sl: sl,
        tps: tps,
        timeString: timeMatch ? timeMatch[1].trim() : '',
        timestamp: Date.now(),
        status: 'active',
        hitTps: [false, false, false, false, false]
      };
    }
  }

  // 2. HIT TP
  if (cleanText.includes('ĐÃ HÍT TP')) {
    const tpLevelMatch = cleanText.match(/ĐÃ HÍT TP(\d+)/i);
    const symbolMatch = cleanText.match(/Symbol:\s*(\S+)/i);
    const actionMatch = cleanText.match(/Lệnh:\s*(🟢|🔴)?\s*(BUY|SELL)/i);
    const entryMatch = cleanText.match(/Entry:\s*([\d\.]+)/i);
    const hitPriceMatch = cleanText.match(/Mức chạm:\s*([\d\.]+)/i);
    const pipsMatch = cleanText.match(/Lợi nhuận:\s*([\+\-\d\.]+)\s*pips/i);
    const origTimeMatch = cleanText.match(/Tín hiệu gốc:\s*(.+?)(?=\n|$)/i);
    const timeMatch = cleanText.match(/Báo lúc:\s*(.+?)(?=\n|$)/i);

    return {
      type: 'EVENT_TP',
      id: parseInt(id),
      tpLevel: tpLevelMatch ? parseInt(tpLevelMatch[1]) : 1,
      symbol: symbolMatch ? symbolMatch[1].trim() : '',
      action: actionMatch ? actionMatch[2].trim().toLowerCase() : '',
      entry: entryMatch ? parseFloat(entryMatch[1]) : 0,
      hitPrice: hitPriceMatch ? parseFloat(hitPriceMatch[1]) : 0,
      pips: pipsMatch ? parseFloat(pipsMatch[1]) : 0,
      originalSignalTime: origTimeMatch ? origTimeMatch[1].trim() : '',
      timeString: timeMatch ? timeMatch[1].trim() : '',
      timestamp: Date.now()
    };
  }

  // 3. HIT SL
  if (cleanText.includes('ĐÃ HÍT SL')) {
    const symbolMatch = cleanText.match(/Symbol:\s*(\S+)/i);
    const actionMatch = cleanText.match(/Lệnh:\s*(🟢|🔴)?\s*(BUY|SELL)/i);
    const entryMatch = cleanText.match(/Entry:\s*([\d\.]+)/i);
    const hitPriceMatch = cleanText.match(/Mức chạm:\s*([\d\.]+)/i);
    const pipsMatch = cleanText.match(/Thua lỗ:\s*([\+\-\d\.]+)\s*pips/i);
    const origTimeMatch = cleanText.match(/Tín hiệu gốc:\s*(.+?)(?=\n|$)/i);
    const timeMatch = cleanText.match(/Báo lúc:\s*(.+?)(?=\n|$)/i);

    return {
      type: 'EVENT_SL',
      id: parseInt(id),
      symbol: symbolMatch ? symbolMatch[1].trim() : '',
      action: actionMatch ? actionMatch[2].trim().toLowerCase() : '',
      entry: entryMatch ? parseFloat(entryMatch[1]) : 0,
      hitPrice: hitPriceMatch ? parseFloat(hitPriceMatch[1]) : 0,
      pips: pipsMatch ? parseFloat(pipsMatch[1]) : 0,
      originalSignalTime: origTimeMatch ? origTimeMatch[1].trim() : '',
      timeString: timeMatch ? timeMatch[1].trim() : '',
      timestamp: Date.now()
    };
  }

  return null;
}

// Update local state and trigger auto-execution if necessary
async function processParsedMessage(item, triggerAutoTradeCallback) {
  if (useMongoDBInstance) {
    try {
      // Check if message ID already processed
      const existingMsg = await dbInstance.collection('tsunami_processed_ids').findOne({ id: item.id });
      if (existingMsg) return;

      // Mark as processed
      await dbInstance.collection('tsunami_processed_ids').insertOne({ id: item.id, type: item.type, processedAt: new Date() });

      if (item.type === 'SIGNAL_NEW') {
        // Save new signal
        await dbInstance.collection('tsunami_signals').insertOne(item);
        console.log(`[Tsunami Scraper] New signal saved: ID ${item.id} - ${item.symbol} ${item.action.toUpperCase()} Entry: ${item.entry}`);
        
        // Emit socket
        ioInstance.emit('tsunami_new_signal', item);

        // Trigger Auto-Trade callback
        if (triggerAutoTradeCallback) {
          triggerAutoTradeCallback(item);
        }
      } else if (item.type === 'EVENT_TP' || item.type === 'EVENT_SL') {
        // Save event log
        await dbInstance.collection('tsunami_events').insertOne(item);
        console.log(`[Tsunami Scraper] New event logged: ID ${item.id} - ${item.symbol} ${item.type} (Entry: ${item.entry})`);
        
        // Emit event to socket
        ioInstance.emit('tsunami_event', item);

        // Find and update original active signal
        // Match approximate entry to counter potential rounding issues
        const query = {
          symbol: item.symbol,
          action: item.action,
          status: 'active',
          entry: { $gte: item.entry - 0.05, $lte: item.entry + 0.05 }
        };

        const originalSignal = await dbInstance.collection('tsunami_signals').findOne(query);
        if (originalSignal) {
          if (item.type === 'EVENT_TP') {
            const hitTps = originalSignal.hitTps || [false, false, false, false, false];
            const levelIdx = item.tpLevel - 1;
            if (levelIdx >= 0 && levelIdx < 5) {
              hitTps[levelIdx] = true;
            }
            const allHit = hitTps[originalSignal.tps.length - 1] === true; // hit target/highest TP
            const updateDoc = {
              $set: {
                hitTps: hitTps,
                status: allHit ? 'closed' : 'hit_tp',
                lastUpdated: new Date()
              }
            };
            await dbInstance.collection('tsunami_signals').updateOne({ _id: originalSignal._id }, updateDoc);
            const updatedSig = { ...originalSignal, hitTps, status: allHit ? 'closed' : 'hit_tp' };
            ioInstance.emit('tsunami_signal_update', updatedSig);
            console.log(`[Tsunami Scraper] Updated signal status to hit_tp/closed (ID: ${originalSignal.id})`);
          } else if (item.type === 'EVENT_SL') {
            await dbInstance.collection('tsunami_signals').updateOne(
              { _id: originalSignal._id },
              { $set: { status: 'closed', lastUpdated: new Date() } }
            );
            const updatedSig = { ...originalSignal, status: 'closed' };
            ioInstance.emit('tsunami_signal_update', updatedSig);
            console.log(`[Tsunami Scraper] Updated signal status to closed/SL (ID: ${originalSignal.id})`);
          }
        }
      }
    } catch (err) {
      console.error('[Tsunami Scraper] Database error processing message:', err.message);
    }
  } else {
    // In-memory fallback
    const alreadyProcessed = memorySignals.some(s => s.id === item.id) || memoryEvents.some(e => e.id === item.id);
    if (alreadyProcessed) return;

    if (item.type === 'SIGNAL_NEW') {
      memorySignals.unshift(item);
      if (memorySignals.length > 100) memorySignals.pop();
      console.log(`[Tsunami Scraper-Mem] New signal saved: ID ${item.id} - ${item.symbol} ${item.action.toUpperCase()}`);
      ioInstance.emit('tsunami_new_signal', item);

      if (triggerAutoTradeCallback) {
        triggerAutoTradeCallback(item);
      }
    } else if (item.type === 'EVENT_TP' || item.type === 'EVENT_SL') {
      memoryEvents.unshift(item);
      if (memoryEvents.length > 200) memoryEvents.pop();
      console.log(`[Tsunami Scraper-Mem] New event logged: ID ${item.id} - ${item.symbol} ${item.type}`);
      ioInstance.emit('tsunami_event', item);

      // Find original active signal
      const originalSignal = memorySignals.find(s => 
        s.symbol === item.symbol &&
        s.action === item.action &&
        s.status === 'active' &&
        Math.abs(s.entry - item.entry) < 0.05
      );

      if (originalSignal) {
        if (item.type === 'EVENT_TP') {
          const hitTps = originalSignal.hitTps || [false, false, false, false, false];
          const levelIdx = item.tpLevel - 1;
          if (levelIdx >= 0 && levelIdx < 5) {
            hitTps[levelIdx] = true;
          }
          const allHit = hitTps[originalSignal.tps.length - 1] === true;
          originalSignal.hitTps = hitTps;
          originalSignal.status = allHit ? 'closed' : 'hit_tp';
          ioInstance.emit('tsunami_signal_update', originalSignal);
          console.log(`[Tsunami Scraper-Mem] Updated signal status (ID: ${originalSignal.id})`);
        } else if (item.type === 'EVENT_SL') {
          originalSignal.status = 'closed';
          ioInstance.emit('tsunami_signal_update', originalSignal);
          console.log(`[Tsunami Scraper-Mem] Closed signal on SL (ID: ${originalSignal.id})`);
        }
      }
    }
  }
}

// Scrape and parse loop
async function scrapeAndProcess(triggerAutoTradeCallback) {
  try {
    const html = await fetchChannelHTML();
    const msgRegex = /data-post="tinhieudep245\/(\d+)"[\s\S]*?<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g;

    let match;
    const parsedItems = [];
    while ((match = msgRegex.exec(html)) !== null) {
      const id = match[1];
      const text = stripHtml(match[2]);
      const parsed = parseMessage(id, text);
      if (parsed) {
        parsedItems.push(parsed);
      }
    }

    // Sort items by ID (chronological) to process signals before hit events
    parsedItems.sort((a, b) => a.id - b.id);

    for (const item of parsedItems) {
      await processParsedMessage(item, triggerAutoTradeCallback);
    }
  } catch (err) {
    console.error('[Tsunami Scraper] Scrape loop execution failed:', err.message);
  }
}

function initTelegramScraper(io, db, useMongoDB, triggerAutoTradeCallback) {
  ioInstance = io;
  dbInstance = db;
  useMongoDBInstance = useMongoDB;

  console.log('[Tsunami Scraper] Initializing Telegram scraper for tinhieudep245 channel...');

  // Run first scrape immediately
  scrapeAndProcess(triggerAutoTradeCallback).catch(console.error);

  // Set interval to scrape every 20 seconds
  const interval = setInterval(() => {
    scrapeAndProcess(triggerAutoTradeCallback).catch(console.error);
  }, 20000);

  return {
    stop: () => clearInterval(interval),
    getSignals: async () => {
      if (useMongoDBInstance) {
        return await dbInstance.collection('tsunami_signals').find({}).sort({ id: -1 }).limit(100).toArray();
      }
      return memorySignals;
    },
    getEvents: async () => {
      if (useMongoDBInstance) {
        return await dbInstance.collection('tsunami_events').find({}).sort({ id: -1 }).limit(100).toArray();
      }
      return memoryEvents;
    }
  };
}

module.exports = {
  initTelegramScraper
};
