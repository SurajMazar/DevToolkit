/**
 * Realistic sample dataset (orders export). Deterministic so screenshots and demos are
 * stable; not used for anything security-relevant.
 */
const FIRST = ['Amelia', 'Kenji', 'Lucía', 'Noah', 'Zoë', 'Priya', 'Mateo', 'Hana', 'Oliver', 'Fatima', 'Lars', 'Chloé', 'Diego', 'Aisha', 'Tomás', 'Mei', 'Jonas', 'Leila', 'Ravi', 'Emma']
const LAST = ['Hart', 'Watanabe', 'Fernández', 'Okafor', 'Laurent', 'Raman', 'Rossi', 'Kim', 'Bennett', 'Haddad', 'Nilsson', 'Dubois', 'García', 'Bello', 'Silva', 'Chen', 'Weber', 'Karimi', 'Iyer', 'Novak']
const CITIES: [string, string, string][] = [
  ['Portland', 'US', '04101'],
  ['Osaka', 'JP', '530-0001'],
  ['Sevilla', 'ES', '41001'],
  ['Lagos', 'NG', '100001'],
  ['Paris', 'FR', '75011'],
  ['Bengaluru', 'IN', '560001'],
  ['Milano', 'IT', '20121'],
  ['Seoul', 'KR', '04524'],
  ['Leeds', 'GB', 'LS1 4AP'],
  ['Berlin', 'DE', '10115'],
]
const STATUS = ['delivered', 'delivered', 'delivered', 'shipped', 'processing', 'cancelled', 'refunded']
const PRODUCTS: [string, string, number][] = [
  ['KB-104', 'Mechanical keyboard, TKL', 89],
  ['MS-220', 'Wireless mouse', 34.5],
  ['HD-310', 'USB-C hub (7-in-1)', 49.99],
  ['MN-27Q', '27" QHD monitor', 289],
  ['CB-002', 'Braided cable 2 m', 12],
  ['DS-140', 'Laptop stand "Riser"', 59],
]

export function sampleCsv(rows = 5000): string {
  let seed = 20240318
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = ['order_id,placed_at,customer,email,city,country,postal_code,sku,product,qty,unit_price,total,status,gift,note']
  const start = Date.UTC(2023, 0, 1)
  for (let i = 0; i < rows; i++) {
    const f = pick(FIRST)
    const l = pick(LAST)
    const [city, country, zip] = pick(CITIES)
    const [sku, product, price] = pick(PRODUCTS)
    const qty = 1 + Math.floor(rnd() * rnd() * 6)
    const placed = new Date(start + Math.floor(rnd() * 600 * 86400_000)).toISOString().slice(0, 19).replace('T', ' ')
    const status = pick(STATUS)
    const note = rnd() < 0.08 ? pick(['Leave at reception', 'Call before delivery, gate code 4411', 'Gift wrap — no invoice in box', 'Customer says: "fragile"']) : ''
    const email = `${f}.${l}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@example.com'
    lines.push(
      [
        `ORD-${String(100000 + i * 7)}`,
        placed,
        q(`${f} ${l}`),
        email,
        city,
        country,
        zip,
        sku,
        q(product),
        qty,
        price.toFixed(2),
        (price * qty).toFixed(2),
        status,
        rnd() < 0.15 ? 'true' : 'false',
        q(note),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}
