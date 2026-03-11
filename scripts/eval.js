import fs from "fs";

const url = process.argv.find(a => a.startsWith("--url="))?.split("=")[1] || "http://localhost:3001/api/chat";

const readSystemPrompt = () => {
  const src = fs.readFileSync("src/App.jsx", "utf8");
  const marker = "const SYSTEM = `";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("SYSTEM prompt not found in src/App.jsx");
  const from = start + marker.length;
  const end = src.indexOf("`", from);
  if (end === -1) throw new Error("SYSTEM prompt end not found");
  return src.slice(from, end);
};

const SYSTEM = readSystemPrompt();

const cases = [
  { name: "basic_trip", prompt: "How do I get from Lagos to Ibadan this evening?" },
  { name: "missing_origin", prompt: "I want to travel to Abuja" },
  { name: "city_guide", prompt: "How do I get around Calabar?" },
  { name: "safety", prompt: "Is Kaduna safe to travel to right now?" },
];

const validate = (text) => {
  if (!text) return ["empty_response"];
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0] || "";
  const errors = [];
  if (!/Live:/i.test(header)) errors.push("missing_live_header");
  if (header.split("|").length < 3) errors.push("header_missing_fields");
  if (/\bAs an AI\b/i.test(text)) errors.push("assistant_boilerplate");
  return errors;
};

const run = async () => {
  const failures = [];
  for (const c of cases) {
    const body = {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: c.prompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      failures.push(`${c.name}: http_${res.status}`);
      continue;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const errs = validate(text);
    if (errs.length) failures.push(`${c.name}: ${errs.join(",")}`);
  }

  if (failures.length) {
    console.error("Eval failed:");
    failures.forEach(f => console.error(" - " + f));
    process.exit(1);
  }
  console.log("Eval passed");
};

run().catch((err) => {
  console.error("Eval error:", err.message);
  process.exit(1);
});

