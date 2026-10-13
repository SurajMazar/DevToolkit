export const SAMPLE_A = `HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
X-Request-Id: 9f1c2e7a-0b3d-4c8e-a1f2-5d6e7f8a9b0c
X-RateLimit-Remaining: 4987

{
  "data": [
    {
      "id": 9007199254740993,
      "number": "ORD-10432",
      "status": "shipped",
      "total": { "amount": 149.9, "currency": "EUR" },
      "customer": { "id": "cus_8Hq2", "email": "ada@example.com", "vip": true },
      "items": [
        { "sku": "KB-75-BRN", "name": "Mechanical keyboard", "qty": 1, "price": 129.9 },
        { "sku": "CBL-USBC-2M", "name": "USB-C cable 2 m", "qty": 2, "price": 10 }
      ],
      "tags": ["priority", "gift"],
      "shipped_at": "2026-10-11T08:14:00Z",
      "coupon": null
    },
    {
      "id": 9007199254740994,
      "number": "ORD-10433",
      "status": "paid",
      "total": { "amount": 32.5, "currency": "EUR" },
      "customer": { "id": "cus_1Lm9", "email": "linus@example.com", "vip": false },
      "items": [{ "sku": "MSE-ERG-01", "name": "Ergonomic mouse", "qty": 1, "price": 32.5 }],
      "tags": [],
      "shipped_at": null
    },
    {
      "id": 9007199254740995,
      "number": "ORD-10434",
      "status": "shipped",
      "total": { "amount": 412, "currency": "USD" },
      "customer": { "id": "cus_4Pz0", "email": "grace@example.com", "vip": true, "company": "Navy Labs" },
      "items": [
        { "sku": "MON-27-4K", "name": "27\\" 4K monitor", "qty": 1, "price": 389 },
        { "sku": "CBL-HDMI-1M", "name": "HDMI cable 1 m", "qty": 1, "price": 23, "discount": 0.1 }
      ],
      "tags": ["b2b"],
      "shipped_at": "2026-10-12T16:40:22Z",
      "coupon": "AUTUMN10"
    }
  ],
  "pagination": { "page": 1, "per_page": 3, "total": 1287, "next": "/v2/orders?page=2" },
  "meta": { "generated_at": "2026-10-13T09:12:44Z", "api_version": "2026-09-01" }
}`

export const SAMPLE_B = `{
  "data": [
    {
      "id": "9007199254740993",
      "number": "ORD-10432",
      "status": "delivered",
      "total": { "amount": 149.9, "currency": "EUR" },
      "customer": { "id": "cus_8Hq2", "email": "ada@example.com", "vip": true },
      "items": [
        { "sku": "KB-75-BRN", "name": "Mechanical keyboard", "qty": 1, "price": 129.9 },
        { "sku": "CBL-USBC-2M", "name": "USB-C cable 2 m", "qty": 2, "price": 10 }
      ],
      "tags": ["priority", "gift"],
      "shipped_at": "2026-10-11T08:14:00Z",
      "delivered_at": "2026-10-13T07:02:10Z"
    }
  ],
  "pagination": { "page": 1, "per_page": 1, "total": 1287, "next_cursor": "eyJwIjoyfQ" },
  "meta": { "generated_at": "2026-10-13T09:15:02Z", "api_version": "2026-10-01" }
}`
