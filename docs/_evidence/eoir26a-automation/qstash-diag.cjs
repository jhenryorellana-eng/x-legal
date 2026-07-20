/* QStash delivery diagnostics — READ-ONLY. Shows recent message events + DLQ. */
const fs=require("fs"),path=require("path");
const env=fs.readFileSync(path.join(__dirname,"../../../.env.local"),"utf8");
const get=(k)=>(env.match(new RegExp("^"+k+"=(.*)$","m"))||[])[1]?.trim().replace(/^["']|["']$/g,"");
const TOKEN=get("QSTASH_TOKEN");
if(!TOKEN){console.error("no QSTASH_TOKEN");process.exit(2);}
(async()=>{
  // recent events (delivery attempts)
  const ev=await fetch("https://qstash.upstash.io/v2/events?limit=25",{headers:{Authorization:"Bearer "+TOKEN}});
  const evj=await ev.json();
  const events=evj.events||evj;
  const counts={};
  const recent=[];
  for(const e of (Array.isArray(events)?events:[])){
    counts[e.state]=(counts[e.state]||0)+1;
    recent.push(`${new Date(e.time).toISOString().slice(11,19)} ${e.state} ${(e.url||"").split("/").slice(-1)[0]} ${e.responseStatus||""} ${(e.error||"").slice(0,60)}`);
  }
  console.log("=== EVENT STATE COUNTS (last 25) ===");
  console.log(JSON.stringify(counts));
  console.log("=== RECENT EVENTS ===");
  console.log(recent.slice(0,20).join("\n"));
  // DLQ
  const dlq=await fetch("https://qstash.upstash.io/v2/dlq?limit=10",{headers:{Authorization:"Bearer "+TOKEN}});
  const dlqj=await dlq.json();
  console.log("=== DLQ (failed messages) count:", (dlqj.messages||[]).length, "===");
  for(const m of (dlqj.messages||[]).slice(0,6)) console.log(`${(m.url||"").split("/").slice(-1)[0]} status=${m.responseStatus} ${(m.responseBody||"").slice(0,80)}`);
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});
