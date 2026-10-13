/** Bookstore inventory — the classic JSONPath example document, with realistic fields. */
export const PATH_SAMPLE = `{
  "store": {
    "name": "Northwind Books",
    "currency": "USD",
    "book": [
      {
        "category": "reference",
        "author": "Nigel Rees",
        "title": "Sayings of the Century",
        "price": 8.95,
        "stock": 14,
        "tags": ["quotes", "history"]
      },
      {
        "category": "fiction",
        "author": "Evelyn Waugh",
        "title": "Sword of Honour",
        "price": 12.99,
        "stock": 0,
        "tags": ["war", "classic"]
      },
      {
        "category": "fiction",
        "author": "Herman Melville",
        "title": "Moby Dick",
        "isbn": "0-553-21311-3",
        "price": 8.99,
        "stock": 7,
        "tags": ["sea", "classic"]
      },
      {
        "category": "fiction",
        "author": "J. R. R. Tolkien",
        "title": "The Lord of the Rings",
        "isbn": "0-395-19395-8",
        "price": 22.99,
        "stock": 31,
        "tags": ["fantasy"]
      }
    ],
    "bicycle": {
      "color": "red",
      "price": 399.0,
      "stock": 2
    }
  },
  "expensive": 10
}
`

export const PATH_EXAMPLES: { expr: string; description: string }[] = [
  { expr: '$.store.book[*].author', description: 'Authors of all books' },
  { expr: '$..author', description: 'All authors, at any depth' },
  { expr: '$.store.*', description: 'Everything directly in the store' },
  { expr: '$..price', description: 'Every price in the document' },
  { expr: '$..book[2]', description: 'The third book' },
  { expr: '$..book[-1:]', description: 'The last book' },
  { expr: '$..book[:2]', description: 'The first two books' },
  { expr: '$..book[?(@.isbn)]', description: 'Books that have an ISBN' },
  { expr: '$..book[?(@.price < 10)].title', description: 'Titles of books cheaper than 10' },
  { expr: "$..book[?(@.category == 'fiction' && @.stock > 0)]", description: 'Fiction that is in stock' },
  { expr: '$..book[?(@.price > @root.expensive)].title', description: 'Compare with another value (@root = document)' },
  { expr: "$..book[?(@.tags.includes('classic'))].title", description: 'Books tagged “classic”' },
  { expr: '$.store.book.length', description: 'Number of books' },
  { expr: '$.store.*~', description: 'Property names of the store' },
]
