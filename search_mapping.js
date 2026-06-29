async function inspect() {
  try {
    const res = await fetch("https://vnwallstreet.org/_next/static/chunks/111xmj4bp17of.js");
    const js = await res.text();
    let pos = 0;
    while (true) {
      const idx = js.indexOf('isimportant', pos);
      if (idx === -1) break;
      console.log(`Found isimportant at ${idx}:`, js.substring(idx - 100, idx + 150));
      pos = idx + 1;
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}
inspect();
