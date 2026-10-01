import urllib.request
import json
import time
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor

today = date(2026, 10, 1)

def run():
    with open("src/data/realSapClientsSV.json") as f:
        clients = json.load(f)

    print(f"Loaded {len(clients)} clients.")
    results = {}

    def process_client(c):
        code = c.get("Codigo")
        if not code:
            return None
        
        url = f"https://san.red.com.sv/consultaIntegral/tablaFacturaR.html?cliente={code}&pais=SV&uniqid={int(time.time()*1000)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        try:
            with urllib.request.urlopen(req, timeout=12) as r:
                invs = json.loads(r.read().decode())
                pends = [i for i in invs if (i.get("estado") or "").upper() == "PENDIENTE"]
                
                total_debt = sum(float(i.get("valordoc") or 0) for i in pends)
                
                # Calculate max overdue days
                max_days = 0
                oldest_due = None
                newest_emision = None
                
                for p in pends:
                    fv = p.get("fechavence")
                    fe = p.get("fechaEmision")
                    if fe and (not newest_emision or fe > newest_emision):
                        newest_emision = fe
                    if fv:
                        try:
                            d_obj = datetime.strptime(fv[:10], "%Y-%m-%d").date()
                            diff = (today - d_obj).days
                            if diff > max_days:
                                max_days = diff
                                oldest_due = fv[:10]
                        except Exception:
                            pass
                
                # If total_debt is 0 (all paid)
                if total_debt == 0:
                    # Check latest paid invoice for emision date
                    if invs:
                        newest_emision = invs[0].get("fechaEmision")
                        oldest_due = invs[0].get("fechavence")

                days_arrears = max(0, max_days)
                
                mora_range = "0-30"
                if days_arrears > 120:
                    mora_range = "120+"
                elif days_arrears > 90:
                    mora_range = "91-120"
                elif days_arrears > 60:
                    mora_range = "61-90"
                elif days_arrears > 30:
                    mora_range = "31-60"
                
                priority = "Normal"
                if days_arrears > 90 or total_debt > 5000:
                    priority = "Alta"
                elif days_arrears > 30 or total_debt > 1000:
                    priority = "Media"
                
                return (code, {
                    "totalDebt": round(total_debt, 2),
                    "pendingCount": len(pends),
                    "totalInvoices": len(invs),
                    "daysArrears": days_arrears,
                    "moraRange": mora_range,
                    "priority": priority,
                    "dueDate": oldest_due or "2026-10-31",
                    "invoiceDate": newest_emision or "2026-10-01"
                })
        except Exception as e:
            return (code, None)

    # Run in parallel with 15 workers
    start_time = time.time()
    with ThreadPoolExecutor(max_workers=15) as pool:
        for item in pool.map(process_client, clients):
            if item and item[1]:
                results[item[0]] = item[1]

    elapsed = time.time() - start_time
    print(f"Processed {len(results)} clients in {elapsed:.2f}s.")
    
    with open("src/data/realDebtsSnapshotSV.json", "w", encoding="utf-8") as out:
        json.dump(results, out, indent=2, ensure_ascii=False)
    print("Saved to src/data/realDebtsSnapshotSV.json")

if __name__ == "__main__":
    run()
