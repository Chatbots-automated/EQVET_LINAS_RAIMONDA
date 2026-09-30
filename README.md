# EQ VET — veterinarinės apskaitos sistema

Sukurta pagal Eq Vet, MB PASLAUGŲ TEIKIMO SUTARTIES §2.2 reikalavimus: gyvūnų
registravimas, veterinarinių produktų pajamavimas, atsargų sunaudojimas ir
nurašymas, produktų likučių apskaita, pagrindiniai veterinariniai žurnalai.

## Technologijų stekas

- **Frontend:** Next.js 16 (App Router) + TypeScript + Tailwind CSS
- **Backend / DB:** Supabase (PostgreSQL, tikra Supabase Auth, Row Level Security)
- **PDF eksportas:** jsPDF + jspdf-autotable (su lietuviškų raidžių palaikymu — Roboto šriftas)
- **Excel/CSV eksportas:** CSV (be papildomų priklausomybių)
- **Deploy:** Netlify (`@netlify/plugin-nextjs`)

## Svarbiausia architektūrinė ypatybė: du nepriklausomi vartotojai viename Supabase projekte

Šis Supabase projektas yra bendras dviem skirtingiems veterinarijos
gydytojams (dvi atskiros sutartys, bendra infrastruktūra). Jie **niekada**
neturi matyti vienas kito duomenų. Todėl:

- Kiekviena verslo lentelė (`clients`, `suppliers`, `products`, `batches`,
  `animals`, `visits`, `usage_items`, ...) turi `user_id` stulpelį (`default auth.uid()`).
- Row Level Security kiekvienoje lentelėje: `using (user_id = auth.uid())`.
  Jokių rolių, jokio bendro matomumo — kiekvienas vartotojas mato ir valdo
  tik savo įrašus.
- Peržiūros (`stock_by_batch`, `stock_by_product`, `stock_movements`,
  `visit_history_view`) naudoja `security_invoker = true`, todėl jos gerbia
  užklausiančio vartotojo, o ne savininko, RLS teises.
- `anon` raktas neturi jokios prieigos prie verslo duomenų — reikalinga tikra
  prisijungimo sesija (`authenticated`).

## Paleidimas

### 1. Paleiskite SQL migracijas — po vieną, šia tvarka

Supabase projekto **SQL Editor** skiltyje paleiskite kiekvieną failą iš
`supabase/migrations/` **atskirai, iš eilės pagal failo vardo numerį**
(kiekvieną nukopijuokite, įklijuokite, paleiskite, tada imkitės kito):

```
supabase/migrations/20260916000001_init_schema.sql          -- lentelės, trigeriai, views
supabase/migrations/20260916000002_auth_and_rls.sql          -- Supabase Auth + RLS pagal user_id
supabase/migrations/20260916000003_admin_access.sql          -- admin paskyra, matanti abu ūkius
supabase/migrations/20260917000001_clients_and_packaging.sql -- klientai, partijų pakuočių laukai
supabase/migrations/20260917000002_supplier_bank_fields.sql  -- tiekėjo IBAN/adresas (iš PDF importo)
supabase/migrations/20260918000001_administration_routes.sql -- karencija pagal suleidimo būdą (i.v, i.m...)
supabase/migrations/20260918000002_client_entity_fields_and_branding.sql -- juridinis asmuo laukai, vet logotipas
supabase/migrations/20260918000003_profile_theme.sql         -- paskyros spalvų tema
supabase/migrations/20260925000001_biocide_category.sql      -- kategorija „Biocidai“ (BŪTINAI atskirai!)
supabase/migrations/20260925000002_biocide_usage_and_journals.sql -- biocidų naudojimas + žurnalų views
supabase/migrations/20260927000001_invoice123_clients.sql      -- Invoice123 klientų sinchronizacija (n8n)
supabase/migrations/20260928000001_invoice123_settings.sql     -- Sąskaita123 integracija: nustatymai + užšifruoti API raktai
supabase/migrations/20260928000002_sales_invoices.sql          -- pardavimo sąskaitos, eilutės, mokėjimai, audito žurnalas, PDF saugykla
supabase/migrations/20260929000001_invoice123_purchases.sql     -- pirkimai (Pajamavimas) → Sąskaita123 išlaidos
supabase/migrations/20260930000001_visit_pricing.sql            -- vizito užbaigimas: vaistų antkainis, paslaugų kainos, vardai žurnaluose
supabase/migrations/20260930000002_service_catalog_and_invoice_visits.sql -- paslaugų sąrašas su kainomis, sąskaita keliems vizitams
```

Naujus migracijų failus ateityje pridėsime tuo pačiu principu — vienas
failas, vienas numeruotas žingsnis, joks vieno didelio failo bundlinimas.

### 2. Sukurkite vartotojų paskyras

Supabase Auth vartotojų negalima sukurti paprastu SQL insertu (per
Dashboard) — naudokite **Authentication → Users → Add user**, įveskite
el. paštą ir slaptažodį, pažymėkite **„Auto Confirm User"**. `profiles`
įrašas kiekvienam sukuriamas automatiškai (`handle_new_user` trigeris).

Administratoriaus paskyrai (mato abu ūkius) — žr. `supabase/scripts/create_admin_user.sql`,
kuriame yra ir SQL variantas be Dashboard.

**Authentication → Settings** — išjunkite **„Allow new users to sign up"**,
kad niekas kitas negalėtų pats užsiregistruoti į šį projektą.

### 3. Aplinkos kintamieji

`.env.local` (į git'ą nepatenka):

```
NEXT_PUBLIC_SUPABASE_URL=https://<projekto-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Tik serverio pusei / provisioning skriptams — NIEKADA nenaudoti kliento kode.
SUPABASE_SERVICE_ROLE_KEY=...

# Neprivaloma: sąskaitų PDF nuskaitymo webhook (žr. žemiau).
NEXT_PUBLIC_INVOICE_WEBHOOK_URL=

# Tik serverio pusei — AES-256-GCM raktas Sąskaita123 API raktams šifruoti.
# Turi sutapti visose aplinkose (lokaliai ir Netlify), kitaip išsaugoti
# raktai nebus iššifruojami.
INVOICE123_TOKEN_ENCRYPTION_KEY=
```

### 4. Įdiekite paketus ir paleiskite

```bash
npm install
npm run dev
```

Reikalauja Node.js ≥22 (Supabase JS klientas įspėja, bet dev serveris veikia
ir su Node 20). Netlify build aplinkoje `NODE_VERSION=22` jau nustatytas
`netlify.toml` faile.

## Sąskaitų PDF nuskaitymas (Pajamavimas)

`Pajamavimas` skiltis palaiko du režimus:

- **Rankinis įvedimas** — visada veikia, jokių papildomų priklausomybių.
  Palaiko „kiek pakuočių" × produkto „pakuotės dydis" → automatinis kiekio
  apskaičiavimas (kaip Vaida).
- **Iš sąskaitos (PDF)** — frontend'as siunčia PDF failą kaip
  `multipart/form-data` (laukas `data`) į `NEXT_PUBLIC_INVOICE_WEBHOOK_URL`.
  Tai **išorinis n8n workflow'as, kurio šis repo nesukuria** — šiuo metu
  nukreiptas į bendrą n8n egzempliorių (`n8n-up8s.onrender.com`).

Realus webhook atsakymo formatas (n8n grąžina `payload` objektą tiesiogiai):

```json
{
  "supplier": { "name": "Tiekėjas UAB", "code": "123456789", "vat_code": "LT123456789", "iban": "LT...", "address": "..." },
  "invoice": { "number": "SF-123", "date": "2026-09-01", "currency": "EUR", "total_net": 100, "total_vat": 21, "total_gross": 121 },
  "items": [
    { "line_no": 1, "sku": "X1", "description": "Produktas X", "qty": 10, "unit": "vnt", "unit_price": 5.5, "net": 55, "vat": 11.55, "gross": 66.55, "batch": "L2026A", "expiry": "2027-01-01" }
  ],
  "totals_check": { "calc_net": 55, "calc_vat": 11.55, "calc_gross": 66.55 },
  "line_count": 1
}
```

Kol `NEXT_PUBLIC_INVOICE_WEBHOOK_URL` nenustatytas, PDF importo skirtukas
rodo pranešimą ir programa automatiškai naudoja rankinį režimą.

## Sąskaita123 (Invoice123) integracija

Vienas integracijos kodas visiems gydytojams — skiriasi tik kiekvieno
vartotojo (`user_id`) konfigūracija. Jokių `if (linas)` sąlygų.

- **Prijungimas:** Nustatymai → Sąskaita123 → įklijuoti API raktą →
  „Prisijungti“. Raktas patikrinamas su Invoice123 prieš išsaugant, tada
  automatiškai sinchronizuojamos serijos, vienetai, bankai, PVM ir kt.
  Pasirinkus numatytąsias reikšmes ir pažymėjus „Integracija aktyvi“ —
  paruošta.
- **Raktų saugumas:** raktas šifruojamas serveryje (AES-256-GCM,
  `INVOICE123_TOKEN_ENCRYPTION_KEY`) ir laikomas `invoice123_credentials`
  lentelėje, kurią gali skaityti tik `service_role`. Naršyklė niekada negauna
  rakto — rodomi tik paskutiniai 4 simboliai.
- **Klientai:** Klientai → „Sinchronizuoti su Sąskaita123“ (pakeičia n8n
  sinchronizaciją). Išrašant sąskaitą nesusietam klientui: įmonės susiejamos
  pagal įmonės kodą, privatūs asmenys — tik vartotojui patvirtinus (niekada
  automatiškai pagal vardą), arba sukuriamas naujas Sąskaita123 klientas.
- **Sąskaitos:** Vizitas → „Išrašyti sąskaitą“ arba Sąskaitos → „Nauja
  sąskaita“. Pirma sukuriamas vietinis įrašas (`sales_invoices`, būsena
  `creating`), tada kviečiamas Sąskaita123. Oficialų numerį (pvz. SF 22)
  suteikia tik Sąskaita123. Dvigubas paspaudimas / pakartojimas su tuo pačiu
  raktu niekada nesukuria antros sąskaitos; neaiškus rezultatas (timeout)
  patikrinamas Sąskaita123 prieš leidžiant kartoti. Sumos perskaičiuojamos
  serveryje sveikais centais.
- **Sąskaitos (PDF, mokėjimai):** PDF saugomas privačioje `invoice-pdfs`
  saugykloje ir pateikiamas per `/api/sales-invoices/[id]/pdf` tik savininkui.
  Mokėjimai (pavedimas / grynais / kita, daliniai) registruojami Sąskaita123.
  „Atnaujinti iš Sąskaita123“ importuoja esamas sąskaitas ir atnaujina
  apmokėjimo būseną.
- **Klientų įkėlimas:** naujas klientas (Klientai → Naujas klientas) iškart
  įkeliamas į Sąskaita123; nesusietiems — mygtukas „Įkelti į Sąskaita123“.
  Sąskaita123 API neleidžia redaguoti klientų, todėl vėlesni pakeitimai lieka
  tik EQ VET.
- **Pirkimai:** Pajamavimas → pirkimo dokumentas (PDF importas arba rankinis
  su „Registruoti kaip pirkimą Sąskaita123“) → „Siųsti į Sąskaita123“.
  PVM tarifas patvirtinamas kiekvienai eilutei; suma su PVM skaičiuojama taip
  pat kaip Sąskaita123 (patikrinta su esamomis išlaidomis). Jei tas pats
  tiekėjo dokumentas jau yra Sąskaita123 — susiejama, dublikatas nekuriamas.
  Išlaidų tipas pasirenkamas nustatymuose (API jų sąrašo neteikia, todėl
  siūlomi naudoti ankstesnėse išlaidose).
- **PVM:** PVM mokėtojų paskyroms sąskaitų išrašymas kol kas blokuojamas —
  PVM skaičiavimas bus įjungtas tik patikrinus su tikra PVM mokėtojo paskyra.
- **Kodas:** `src/lib/invoice123/` (vienintelis HTTP klientas `client.ts`),
  serverio veiksmai `src/app/(app)/settings/invoice123/actions.ts`. Nuomininkas
  visada nustatomas iš patikrintos sesijos (`src/lib/tenant.ts`), niekada iš
  naršyklės duomenų.

## Invoice123 klientų sinchronizacija (n8n)

n8n workflow'as paima klientus iš Invoice123 ir kviečia Supabase RPC
`sync_invoice123_clients` su **service_role** raktu:

```
POST https://<projekto-ref>.supabase.co/rest/v1/rpc/sync_invoice123_clients
apikey: <SERVICE_ROLE_KEY>
Authorization: Bearer <SERVICE_ROLE_KEY>
Content-Type: application/json

{ "p_owner_email": "eqvetlinas@gmail.com", "p_clients": [ ...Invoice123 data.result... ] }
```

- `p_owner_email` nurodo, kurio gydytojo paskyrai priklauso klientai
  (Linas — `eqvetlinas@gmail.com`). Klientai įrašomi su to vartotojo `user_id`,
  todėl kitas gydytojas jų nemato.
- Sutapatinama pagal `(user_id, external_source='invoice123', external_id)` —
  kartotinis paleidimas atnaujina, o ne dubliuoja. Telefonas, el. paštas ir
  pastabos (įvesti programoje) neperrašomi.
- Funkcija neprieinama prisijungusiems vartotojams — tik service_role.

## Duomenų bazės architektūra

- **FIFO atsargų valdymas:** kiekviena partija (`batches`) turi `qty_left`,
  automatiškai atnaujinamą trigeriu, kai sukuriamas `usage_items` įrašas.
- **`usage_items`** — vienintelis atsargų sunaudojimo (nurašymo) šaltinis,
  visada susietas su konkrečiu vizitu (`visits`).
- **`fn_fifo_batch(product_id)`** — pasiūlo artimiausio galiojimo partiją
  konkrečiam produktui, atsižvelgiant tik į kviečiančio vartotojo partijas.
- Ištrynus vizitą arba `usage_items` eilutę, atitinkamos atsargos
  automatiškai atstatomos (`restore_batch_qty_left` trigeris).

## Moduliai

Grupuota į dvi sekcijas navigacijoje:

**Veterinarija**

| Modulis | Aprašymas |
|---|---|
| Pagrindinis | Suvestinė — aktyvūs gyvūnai, mėnesio vizitai/pajamos, atsargų dėmesio reikalaujantys produktai |
| Klientai | Gyvūnų savininkai/ūkiai — kiekvienas gyvūnas priklauso klientui (`animals.client_id`) |
| Gyvūnai | Gyvūnų registras, pagrindiniai duomenys, nuoroda į vizitų istoriją |
| Vizitai | Gydymo/apsilankymo registravimas su automatiniu produktų nurašymu |
| Biocidai | Biocidų (kategorija „Biocidai“) panaudojimas — nurašoma per tą patį FIFO `usage_items` mechanizmą |

**Apskaita**

| Modulis | Aprašymas |
|---|---|
| Pajamavimas | Prekių priėmimas — rankiniu būdu (su pakuočių skaičiavimu) arba iš sąskaitos PDF |
| Atsargos | Likučiai pagal produktą arba pagal partiją (FIFO), galiojimo/mažo likučio įspėjimai |
| Produktai | Produktų katalogas (kategorija, vienetas, pakuotės dydis, išlaukos ir kt.) |
| Ataskaitos | Gydomų gyvūnų registras, vaistų žurnalas, biocidų žurnalas, vizitų suvestinė, atsargų judėjimas — CSV/PDF eksportas |

Tiekėjai (`suppliers`) nebeturi atskiro puslapio — kuriami/pasirenkami
tiesiogiai Pajamavimo ekrane (rankiniu būdu arba automatiškai iš PDF importo).

## Saugumas

- Tikra Supabase Auth sesija reikalinga visoms verslo duomenų operacijoms.
- `proxy.ts` (Next.js 16 pervadinta middleware) atlieka tik optimistinį
  peradresavimą — tikroji prieigos kontrolė yra RLS politikose.
- `(app)` maršrutų grupės serverio layout papildomai patikrina sesiją prieš
  atvaizduojant bet kokį turinį.
- `SUPABASE_SERVICE_ROLE_KEY` niekada nenaudojamas kliento kode — tik
  provisioning/administravimo tikslams.
