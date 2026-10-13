/**
 * Embedded datasets for synthetic sample data. Names are common given/family names from
 * many cultures; combinations are random and do not describe real people. Company names
 * are assembled from neutral word parts so they are fictional.
 */

const split = (s: string) => s.trim().split(/\s*\|\s*/)

export const FIRST_NAMES = split(`
Aaliyah | Aarav | Abdullah | Ada | Adebayo | Adriana | Ahmed | Aiko | Aisha | Akira | Alejandro | Alessandro | Alexei | Alice | Amara | Amelia |
Amir | Ana | Anders | Andrea | Ángel | Anika | Annika | Antoine | Arjun | Astrid | Ayşe | Beatriz | Benjamin | Bianca | Bilal | Bongani |
Bruno | Camila | Carlos | Carmen | Chen | Chiara | Chidi | Chloe | Cristina | Daniel | Daniela | Dara | David | Diego | Dmitri | Elena |
Elif | Elijah | Emeka | Emil | Emily | Emma | Erik | Esther | Ethan | Eva | Fatima | Felix | Fernando | Fiona | Francesca | Freya |
Gabriel | Grace | Hamza | Hana | Hannah | Haruto | Hassan | Hiroshi | Ibrahim | Ines | Ingrid | Isabel | Isaac | Ivan | Jakub | James |
Jamal | Javier | Ji-woo | Jin | João | Jonas | Jose | Julia | Kai | Kalani | Karim | Kateřina | Kavya | Kenji | Kofi | Lars |
Layla | Leila | Leon | Liam | Lina | Lucas | Lucía | Luis | Maja | Malik | Mana | Marco | María | Mariam | Mateo | Matteo |
Maya | Mehmet | Mei | Mia | Mikael | Min-jun | Mohammed | Nadia | Naledi | Nia | Niamh | Nikolai | Noah | Noor | Olga | Olivia |
Omar | Oscar | Pablo | Priya | Rafael | Rahul | Ravi | Rina | Rosa | Ruth | Sakura | Samuel | Sara | Sebastian | Shreya | Siddharth |
Sofia | Sora | Sven | Tamar | Tariq | Thabo | Thomas | Tomás | Valentina | Vera | Victor | Wei | Wanjiru | Xin | Yara | Yasmin |
Yuki | Yusuf | Zainab | Zara | Zeynep | Zoe
`)

export const LAST_NAMES = split(`
Abe | Acheampong | Adeyemi | Agarwal | Ahmed | Alvarez | Andersen | Andersson | Bakker | Banerjee | Becker | Bergström | Bianchi | Brown | Castro | Chen |
Cohen | Costa | Da Silva | Dahl | Das | Dubois | Dvořák | Eriksen | Fernandes | Fernández | Fischer | Fontaine | García | Gonzalez | Gupta | Haddad |
Hansen | Hashimoto | Hernández | Hoffmann | Horvat | Hussain | Ibrahim | Ivanova | Jansen | Jensen | Johansson | Kamau | Kang | Kapoor | Khan | Kim |
Kowalski | Kumar | Larsen | Laurent | Lee | Lefebvre | Li | Lindqvist | Liu | López | Mahlangu | Martin | Martínez | Mendoza | Meyer | Moreau |
Morales | Müller | Murphy | Nakamura | Nguyen | Novak | Nowak | O'Brien | Okafor | Okonkwo | Olsen | Ortiz | Osei | Park | Patel | Pereira |
Petrov | Popescu | Rahman | Ramírez | Reddy | Rossi | Russo | Saito | Santos | Sato | Schmidt | Schneider | Sharma | Silva | Singh | Smith |
Sokolova | Suzuki | Svensson | Takahashi | Tanaka | Taylor | Torres | Tran | Van der Berg | Varga | Wagner | Walker | Wang | Weber | Williams | Wong |
Wu | Yamamoto | Yang | Yilmaz | Yoon | Zhang | Zhou | Zulu
`)

const COMPANY_A = split(`
Amber | Apex | Arbor | Atlas | Aurora | Beacon | Birch | Blue Fern | Bright | Canopy | Cedar | Cinder | Clearwater | Cobalt | Copper | Coral |
Crescent | Delta | Ember | Evergreen | Falcon | Fieldstone | Granite | Harbor | Helix | Horizon | Indigo | Iron Leaf | Juniper | Kestrel | Lantern | Lumen |
Maple | Meridian | Mosaic | North Pine | Nova | Oak & Ash | Orbit | Pebble | Pinecrest | Prairie | Quartz | Redwood | Ridge | Saffron | Silverline | Slate |
Solstice | Summit | Tidal | Timber | Vantage | Verdant | Willow | Zenith
`)
const COMPANY_B = split(`
Analytics | Bakery | Collective | Consulting | Design Co. | Dynamics | Foods | Freight | Goods | Group | Health | Holdings | Industries | Interactive | Labs | Logistics |
Media | Mobility | Networks | Outfitters | Partners | Robotics | Software | Solutions | Studio | Supply | Systems | Technologies | Telecom | Ventures | Works
`)

export function companyName(a: number, b: number): string {
  return `${COMPANY_A[a % COMPANY_A.length]} ${COMPANY_B[b % COMPANY_B.length]}`
}
export const COMPANY_PARTS = [COMPANY_A.length, COMPANY_B.length] as const

export const JOB_TITLES = split(`
Account Executive | Accountant | Backend Engineer | Brand Designer | Business Analyst | Chief Financial Officer | Chief Technology Officer | Content Strategist |
Customer Success Manager | Data Analyst | Data Engineer | Data Scientist | Database Administrator | DevOps Engineer | Engineering Manager | Financial Analyst |
Frontend Engineer | Full-Stack Developer | Graphic Designer | HR Business Partner | IT Support Specialist | Legal Counsel | Machine Learning Engineer | Marketing Manager |
Mobile Developer | Office Manager | Operations Manager | Payroll Specialist | Platform Engineer | Product Designer | Product Manager | Project Coordinator |
QA Engineer | Recruiter | Research Scientist | Sales Manager | Security Engineer | Site Reliability Engineer | Social Media Manager | Software Architect |
Solutions Architect | Staff Engineer | Supply Chain Analyst | Support Engineer | Technical Writer | UX Researcher | VP of Engineering | Warehouse Supervisor
`)

export const STREET_NAMES = split(`
Acacia | Alder | Ash | Aspen | Bay | Beech | Birch | Brook | Canal | Castle | Cedar | Chapel | Cherry | Church | Cliff | Clover |
Elm | Fern | Field | Forest | Garden | Glen | Granite | Harbor | Hawthorn | Hazel | Heather | Highland | Hill | Holly | Juniper | Lake |
Laurel | Linden | Maple | Market | Meadow | Mill | Oak | Orchard | Park | Pine | Poplar | Quarry | River | Rose | Sage | School |
Spring | Station | Sunset | Sycamore | Valley | Vine | Walnut | Willow
`)
export const STREET_TYPES = split(`Street | Avenue | Road | Lane | Way | Drive | Place | Court | Terrace | Boulevard | Close | Row`)

export interface Place {
  city: string
  country: string
  /** ISO 3166-1 alpha-2. */
  code: string
}

const PLACES_RAW = `
Accra,Ghana,GH|Addis Ababa,Ethiopia,ET|Amsterdam,Netherlands,NL|Ankara,Türkiye,TR|Athens,Greece,GR|Auckland,New Zealand,NZ|Austin,United States,US|Bangalore,India,IN|
Bangkok,Thailand,TH|Barcelona,Spain,ES|Beijing,China,CN|Belo Horizonte,Brazil,BR|Bergen,Norway,NO|Berlin,Germany,DE|Bogotá,Colombia,CO|Boston,United States,US|
Brisbane,Australia,AU|Brussels,Belgium,BE|Bucharest,Romania,RO|Budapest,Hungary,HU|Buenos Aires,Argentina,AR|Busan,South Korea,KR|Cairo,Egypt,EG|Calgary,Canada,CA|
Cape Town,South Africa,ZA|Casablanca,Morocco,MA|Chennai,India,IN|Chicago,United States,US|Copenhagen,Denmark,DK|Cork,Ireland,IE|Curitiba,Brazil,BR|Dakar,Senegal,SN|
Delhi,India,IN|Denver,United States,US|Dubai,United Arab Emirates,AE|Dublin,Ireland,IE|Durban,South Africa,ZA|Edinburgh,United Kingdom,GB|Frankfurt,Germany,DE|Fukuoka,Japan,JP|
Gdańsk,Poland,PL|Geneva,Switzerland,CH|Gothenburg,Sweden,SE|Guadalajara,Mexico,MX|Hamburg,Germany,DE|Hanoi,Vietnam,VN|Helsinki,Finland,FI|Ho Chi Minh City,Vietnam,VN|
Hong Kong,China,HK|Hyderabad,India,IN|Istanbul,Türkiye,TR|Jakarta,Indonesia,ID|Johannesburg,South Africa,ZA|Karachi,Pakistan,PK|Kigali,Rwanda,RW|Kraków,Poland,PL|
Kuala Lumpur,Malaysia,MY|Kyoto,Japan,JP|Lagos,Nigeria,NG|Leeds,United Kingdom,GB|Lima,Peru,PE|Lisbon,Portugal,PT|Ljubljana,Slovenia,SI|London,United Kingdom,GB|
Los Angeles,United States,US|Lyon,France,FR|Madrid,Spain,ES|Manchester,United Kingdom,GB|Manila,Philippines,PH|Marseille,France,FR|Medellín,Colombia,CO|Melbourne,Australia,AU|
Mexico City,Mexico,MX|Milan,Italy,IT|Montevideo,Uruguay,UY|Montréal,Canada,CA|Mumbai,India,IN|Munich,Germany,DE|Nairobi,Kenya,KE|Naples,Italy,IT|
New York,United States,US|Osaka,Japan,JP|Oslo,Norway,NO|Ottawa,Canada,CA|Paris,France,FR|Perth,Australia,AU|Porto,Portugal,PT|Prague,Czechia,CZ|
Pune,India,IN|Quito,Ecuador,EC|Reykjavík,Iceland,IS|Riga,Latvia,LV|Rio de Janeiro,Brazil,BR|Rome,Italy,IT|Rotterdam,Netherlands,NL|San Francisco,United States,US|
Santiago,Chile,CL|São Paulo,Brazil,BR|Seattle,United States,US|Seoul,South Korea,KR|Seville,Spain,ES|Shanghai,China,CN|Singapore,Singapore,SG|Sofia,Bulgaria,BG|
Stockholm,Sweden,SE|Sydney,Australia,AU|Taipei,Taiwan,TW|Tallinn,Estonia,EE|Tel Aviv,Israel,IL|Tokyo,Japan,JP|Toronto,Canada,CA|Tunis,Tunisia,TN|
Utrecht,Netherlands,NL|Valencia,Spain,ES|Vancouver,Canada,CA|Vienna,Austria,AT|Vilnius,Lithuania,LT|Warsaw,Poland,PL|Wellington,New Zealand,NZ|Zagreb,Croatia,HR|Zürich,Switzerland,CH
`
export const PLACES: Place[] = PLACES_RAW.trim()
  .split(/\s*\|\s*/)
  .map((s) => {
    const [city, country, code] = s.split(',')
    return { city, country, code }
  })

/** Postcode patterns per country: 9 = digit, A = letter. Fictional values, plausible shape. */
export const POSTCODE_PATTERNS: Record<string, string> = {
  US: '99999',
  GB: 'A9 9AA',
  CA: 'A9A 9A9',
  NL: '9999 AA',
  JP: '999-9999',
  IN: '999999',
  BR: '99999-999',
  PL: '99-999',
  PT: '9999-999',
  IE: 'A99 A9A9',
  AR: 'A9999AAA',
  SE: '999 99',
  CZ: '999 99',
  KR: '99999',
  CN: '999999',
  HK: '',
  AE: '',
  SG: '999999',
  AU: '9999',
  NZ: '9999',
  ZA: '9999',
  NO: '9999',
  DK: '9999',
  CH: '9999',
  AT: '9999',
  BE: '9999',
  HU: '9999',
  LV: 'LV-9999',
  SI: '9999',
  IS: '999',
}
export const DEFAULT_POSTCODE = '99999'

export const URL_PATHS = split(`about | account | api | articles | blog | cart | catalog | checkout | docs | events | help | items | news | orders | posts | pricing | products | profile | settings | shop | support | team | users`)

export const PRODUCT_ADJECTIVES = split(`Classic | Compact | Deluxe | Eco | Ergonomic | Essential | Everyday | Lightweight | Modern | Organic | Portable | Premium | Rugged | Smart | Sleek | Vintage | Wireless`)
export const PRODUCT_NOUNS = split(`Backpack | Blender | Bottle | Candle | Chair | Desk Lamp | Headphones | Jacket | Keyboard | Kettle | Mug | Notebook | Planter | Scarf | Sneakers | Speaker | Tea Set | Throw Blanket | Watch | Yoga Mat`)
