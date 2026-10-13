export const JSON_A = `{
  "order": {
    "id": "ord_8f3k2",
    "status": "pending",
    "createdAt": "2024-05-02T09:14:00Z",
    "updatedAt": "2024-05-02T09:14:00Z",
    "customer": {
      "id": 1042,
      "name": "Ada Lovelace",
      "email": "ada@example.com",
      "tier": "silver"
    },
    "items": [
      { "sku": "KB-01", "name": "Mechanical keyboard", "qty": 1, "price": 129.0 },
      { "sku": "MS-02", "name": "Wireless mouse", "qty": 2, "price": 39.5 },
      { "sku": "CB-07", "name": "USB-C cable", "qty": 3, "price": 9.99 }
    ],
    "shipping": { "method": "standard", "cost": 4.99, "address": { "city": "London", "postcode": "N1 9GU" } },
    "discountCode": null,
    "ledgerId": 9007199254740993,
    "tags": ["web", "first-order"]
  }
}`

export const JSON_B = `{
  "order": {
    "id": "ord_8f3k2",
    "status": "shipped",
    "createdAt": "2024-05-02T09:14:00Z",
    "updatedAt": "2024-05-03T16:40:12Z",
    "customer": {
      "id": "1042",
      "name": "Ada Lovelace",
      "email": "ada.lovelace@example.com",
      "tier": "gold"
    },
    "items": [
      { "sku": "KB-01", "name": "Mechanical keyboard", "qty": 1, "price": 129.0 },
      { "sku": "HP-11", "name": "Headphones", "qty": 1, "price": 89.0 },
      { "sku": "MS-02", "name": "Wireless mouse", "qty": 1, "price": 39.5 },
      { "sku": "CB-07", "name": "USB-C cable", "qty": 3, "price": 9.99 }
    ],
    "shipping": { "method": "express", "cost": 12.5, "address": { "city": "London", "postcode": "N1 9GU" }, "tracking": "1Z999AA10123456784" },
    "ledgerId": 9007199254740993,
    "tags": ["web", "first-order", "priority"]
  }
}`
