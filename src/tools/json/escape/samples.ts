/** Samples for each escape mode (realistic webhook / log payloads). */
export const TEXT_SAMPLE = `He said "hello" and left.
Path: C:\\Users\\dana\\notes.txt
Tab:\there — emoji 😀, accent é, CJK 東京`

export const LITERAL_SAMPLE = `"{\\"event\\":\\"order.created\\",\\"order\\":{\\"id\\":10482,\\"note\\":\\"Leave at the door\\\\nRing twice\\"}}"`

export const NESTED_SAMPLE = `{
  "id": "evt_1PxQ8v",
  "type": "order.created",
  "source": "webhook",
  "body": "{\\"order\\":{\\"id\\":10482,\\"total\\":214.38,\\"items\\":\\"[{\\\\\\"sku\\\\\\":\\\\\\"KB-75-BRN\\\\\\",\\\\\\"qty\\\\\\":1}]\\"},\\"customer\\":\\"zoe@example.se\\"}",
  "headers": "{\\"content-type\\":\\"application/json\\",\\"x-retry\\":\\"0\\"}",
  "attempt": "1"
}`

export const JSON_SAMPLE = `{
  "event": "order.created",
  "order": { "id": 10482, "note": "Leave at the door\\nRing twice", "total": 214.38 },
  "tags": ["priority", "gift"]
}`
