/** Service configuration + profile: nested objects, arrays, nulls and empty values. */
export const SAMPLE_A = `{
  "service": "checkout-api",
  "version": "2.14.0",
  "owner": { "team": "payments", "slack": "#payments-oncall", "pager": null },
  "http": {
    "port": 8080,
    "cors": { "origins": ["https://shop.example.com", "https://admin.example.com"], "credentials": true },
    "timeouts": { "read_ms": 5000, "write_ms": 5000, "idle_ms": null }
  },
  "database": {
    "primary": { "host": "db-primary.internal", "port": 5432, "pool": { "min": 2, "max": 20 } },
    "replicas": [
      { "host": "db-replica-1.internal", "port": 5432, "lag_alert_ms": 2000 },
      { "host": "db-replica-2.internal", "port": 5432, "lag_alert_ms": null }
    ]
  },
  "features": { "apple_pay": true, "klarna": false, "gift_cards": "", "experiments": [] },
  "limits": { "max_items": 250, "max_order_value": 9007199254740993 },
  "tags": ["tier-1", "pci"],
  "notes": {}
}
`

/** Production overrides for the same service (for Merge and Compare). */
export const SAMPLE_B = `{
  "version": "2.15.0",
  "owner": { "pager": "pd-checkout" },
  "http": {
    "port": "8443",
    "cors": { "origins": ["https://shop.example.com"] },
    "timeouts": { "idle_ms": 60000 }
  },
  "database": {
    "replicas": [
      { "host": "db-replica-1.prod", "lag_alert_ms": 1000 },
      { "host": "db-replica-3.prod", "port": 5432, "lag_alert_ms": 1000 }
    ]
  },
  "features": { "klarna": true, "experiments": ["one-click"] },
  "tags": ["prod"],
  "region": "eu-north-1"
}
`

/** Flat key/value form (e.g. from env files or flattened exports) for Unflatten. */
export const FLAT_SAMPLE = `{
  "service": "checkout-api",
  "http.port": 8080,
  "http.cors.origins.0": "https://shop.example.com",
  "http.cors.origins.1": "https://admin.example.com",
  "http.cors.credentials": true,
  "database.primary.host": "db-primary.internal",
  "database.primary.pool.max": 20,
  "database.replicas[0].host": "db-replica-1.internal",
  "database.replicas[1].host": "db-replica-2.internal",
  "features.apple_pay": true
}
`
