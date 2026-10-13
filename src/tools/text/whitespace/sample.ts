// A snippet "copied from a chat / web page": BOM, NBSP, zero-width space inside an identifier,
// a bidi override, em space, trailing whitespace, mixed tabs/spaces and mixed line endings.
export const SAMPLE_WHITESPACE = [
  '﻿# deploy.yml — pasted from the team wiki\r\n',
  'service: billing-api   \r\n',
  '  image: registry.local/billing:2.4.1\r\n',
  '\tport: 8080\n',
  '  \thealthcheck: /health​\n',
  '  env:\n',
  '    API_TOKEN: "${API​_TOKEN}"\n',
  '    REGION: eu-west-1\t\n',
  '    # owner: ‮resu-nimda‬\n',
  '  replicas: 3\r',
  '  command: ["./start.sh", "--port", "8080"]\n',
  'notes: Use the staging cluster first.  \n',
  'contact: ops‍@example.com\n',
].join('')
