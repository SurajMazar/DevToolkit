/** A realistic paginated orders API response (nested objects, arrays, nulls, a 64-bit id, unicode). */
export const TREE_SAMPLE = `{
  "object": "list",
  "url": "/v1/orders",
  "has_more": true,
  "data": [
    {
      "id": "ord_1PxQ8vKZ2eZvKYlo",
      "number": 10482,
      "status": "fulfilled",
      "created_at": "2024-11-05T14:21:09Z",
      "currency": "EUR",
      "customer": {
        "id": "cus_9s6XKzkNb",
        "name": "Zoë Lindqvist",
        "email": "zoe.lindqvist@example.se",
        "phone": null,
        "tags": ["vip", "newsletter"],
        "address": {
          "line1": "Götgatan 14",
          "line2": null,
          "city": "Stockholm",
          "postal_code": "118 46",
          "country": "SE"
        }
      },
      "items": [
        {
          "sku": "KB-75-BRN",
          "name": "Mechanical keyboard (75%, brown switches)",
          "quantity": 1,
          "unit_price": 149.0,
          "discounts": []
        },
        {
          "sku": "CBL-USBC-2M",
          "name": "USB-C cable, braided, 2 m",
          "quantity": 2,
          "unit_price": 12.5,
          "discounts": [{ "code": "BUNDLE10", "amount": 2.5 }]
        }
      ],
      "totals": { "subtotal": 174.0, "discount": 2.5, "shipping": 0, "tax": 42.88, "total": 214.38 },
      "payment": {
        "method": "card",
        "brand": "visa",
        "last4": "4242",
        "captured": true,
        "processor_reference": 9223372036854775807
      },
      "shipment": {
        "carrier": "PostNord",
        "tracking_number": "00370726201234567890",
        "events": [
          { "at": "2024-11-05T18:02:00Z", "status": "label_created", "location": "Stockholm" },
          { "at": "2024-11-06T07:45:00Z", "status": "in_transit", "location": "Arlanda" },
          { "at": "2024-11-07T11:30:00Z", "status": "delivered", "location": "Stockholm" }
        ]
      },
      "metadata": { "channel": "web", "utm_campaign": "black-friday-early", "gift": false }
    },
    {
      "id": "ord_1PxQ9aLM4fAvXqTr",
      "number": 10483,
      "status": "awaiting_payment",
      "created_at": "2024-11-05T15:02:44Z",
      "currency": "JPY",
      "customer": {
        "id": "cus_4hY2WqPa1",
        "name": "山田 太郎",
        "email": "taro.yamada@example.jp",
        "phone": "+81 90-1234-5678",
        "tags": [],
        "address": {
          "line1": "渋谷区神南1-2-3",
          "line2": "Apt 502",
          "city": "Tokyo",
          "postal_code": "150-0041",
          "country": "JP"
        }
      },
      "items": [
        { "sku": "MON-27-4K", "name": "27\\" 4K monitor", "quantity": 1, "unit_price": 54800, "discounts": [] }
      ],
      "totals": { "subtotal": 54800, "discount": 0, "shipping": 1200, "tax": 5600, "total": 61600 },
      "payment": null,
      "shipment": null,
      "metadata": { "channel": "ios", "gift": true, "gift_message": "お誕生日おめでとう！" }
    }
  ],
  "pagination": { "page": 1, "per_page": 2, "total": 1873, "next_cursor": "eyJpZCI6MTA0ODN9" }
}
`
