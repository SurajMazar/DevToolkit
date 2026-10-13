/** A user-account payload with a few deliberate problems, and the schema it should satisfy. */
export const DOC_SAMPLE = `{
  "id": "usr_8f3k2m",
  "email": "dana.okafor at example.com",
  "name": { "given": "Dana", "family": "Okafor" },
  "age": 17,
  "roles": ["editor", "billing", "editor"],
  "plan": {
    "tier": "team",
    "seats": "12",
    "renews_at": "2025-03-01T00:00:00Z"
  },
  "addresses": [
    { "type": "billing", "line1": "12 Harbour Rd", "city": "Lagos", "country": "NG" },
    { "type": "shipping", "line1": "4 Marina St", "country": "Nigeria" }
  ],
  "marketing_opt_in": true,
  "nickname": "dee"
}
`

export const SCHEMA_SAMPLE = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/user.json",
  "title": "User account",
  "type": "object",
  "required": ["id", "email", "name", "roles", "plan"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^usr_[a-z0-9]{6,}$" },
    "email": { "type": "string", "format": "email" },
    "name": {
      "type": "object",
      "required": ["given", "family"],
      "properties": {
        "given": { "type": "string", "minLength": 1 },
        "family": { "type": "string", "minLength": 1 }
      }
    },
    "age": { "type": "integer", "minimum": 18 },
    "roles": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": { "enum": ["owner", "admin", "editor", "viewer", "billing"] }
    },
    "plan": {
      "type": "object",
      "required": ["tier", "seats"],
      "properties": {
        "tier": { "enum": ["free", "pro", "team", "enterprise"] },
        "seats": { "type": "integer", "minimum": 1 },
        "renews_at": { "type": "string", "format": "date-time" }
      }
    },
    "addresses": {
      "type": "array",
      "items": { "$ref": "#/$defs/address" }
    },
    "marketing_opt_in": { "type": "boolean" }
  },
  "$defs": {
    "address": {
      "type": "object",
      "required": ["type", "line1", "city", "country"],
      "properties": {
        "type": { "enum": ["billing", "shipping"] },
        "line1": { "type": "string" },
        "city": { "type": "string" },
        "country": { "type": "string", "pattern": "^[A-Z]{2}$", "description": "ISO 3166-1 alpha-2" }
      }
    }
  }
}
`
