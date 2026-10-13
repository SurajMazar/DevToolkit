import { describe, expect, it } from 'vitest'
import { DEFAULT_SQL_FORMAT, describeSqlError, formatSql, lexOptionsFor, lexSql, minifySql, protectedSegments, SqlLexError } from './sql'

const pg = lexOptionsFor('postgresql')
const my = lexOptionsFor('mysql')
const ts = lexOptionsFor('transactsql')
const std = lexOptionsFor('sql')

describe('minifySql', () => {
  it('collapses whitespace and removes comments', () => {
    const sql = `SELECT  a,\n  b   -- trailing comment\nFROM   t /* block */\nWHERE  x = 1 ;`
    const r = minifySql(sql, pg)
    expect(r.output).toBe('SELECT a,b FROM t WHERE x = 1;')
    expect(r.removedComments).toBe(2)
  })

  it('never alters string literals', () => {
    const sql = "SELECT 'a  --  not a comment /* nor this */'  ,  'it''s'  FROM t"
    const r = minifySql(sql, pg)
    expect(r.output).toBe("SELECT 'a  --  not a comment /* nor this */','it''s' FROM t")
  })

  it('keeps adjacent string literals apart (no accidental quote escaping)', () => {
    expect(minifySql("SELECT 'a'   'b'", std).output).toBe("SELECT 'a' 'b'")
    expect(minifySql("SELECT 'a'/* x */'b'", std).output).toBe("SELECT 'a' 'b'")
  })

  it('preserves double-quoted, backtick and bracket identifiers', () => {
    expect(minifySql('SELECT "my  col" ,  "a""b" FROM "My  Table"', pg).output).toBe('SELECT "my  col","a""b" FROM "My  Table"')
    expect(minifySql('SELECT `my  col` FROM `db`.`t  1`', my).output).toBe('SELECT `my  col` FROM `db`.`t  1`')
    expect(minifySql('SELECT [my  col], [a]]b] FROM [dbo].[t  1]', ts).output).toBe('SELECT [my  col],[a]]b] FROM [dbo].[t  1]')
  })

  it('preserves dollar-quoted bodies including comments and whitespace inside', () => {
    const fn = `CREATE FUNCTION f() RETURNS int AS $$\n  -- inside body\n  SELECT   1;\n$$ LANGUAGE sql;`
    expect(minifySql(fn, pg).output).toBe(`CREATE FUNCTION f() RETURNS int AS $$\n  -- inside body\n  SELECT   1;\n$$ LANGUAGE sql;`)
    const tagged = `DO $body$ BEGIN RAISE NOTICE '$$'; /* keep */ END $body$;`
    expect(minifySql(tagged, pg).output).toBe(tagged)
  })

  it('does not mistake positional parameters for dollar quotes', () => {
    expect(minifySql('SELECT * FROM t WHERE a = $1  AND  b = $2', pg).output).toBe('SELECT * FROM t WHERE a = $1 AND b = $2')
  })

  it('handles dialect-specific escapes', () => {
    // MySQL: backslash escapes the quote.
    expect(minifySql("SELECT 'it\\'s  here'   FROM t", my).output).toBe("SELECT 'it\\'s  here' FROM t")
    // Standard SQL: backslash is literal, so the string ends at the second quote.
    expect(minifySql("SELECT 'C:\\'   ,  1", std).output).toBe("SELECT 'C:\\',1")
    // PostgreSQL E'' strings allow backslash escapes.
    expect(minifySql("SELECT E'a\\'b'   x", pg).output).toBe("SELECT E'a\\'b' x")
  })

  it('handles MySQL # comments and the "--" whitespace rule', () => {
    expect(minifySql('SELECT 1 # comment\n, 2', my).output).toBe('SELECT 1,2')
    expect(minifySql('SELECT 5--1', my).output).toBe('SELECT 5--1')
    // In PostgreSQL # is an operator, not a comment.
    expect(minifySql('SELECT 5 # 3', pg).output).toBe('SELECT 5 # 3')
  })

  it('handles nested block comments in PostgreSQL', () => {
    expect(minifySql('SELECT /* a /* b */ c */ 1', pg).output).toBe('SELECT 1')
  })

  it('never creates comment tokens by gluing', () => {
    expect(minifySql('SELECT 1 - -1', pg).output).toBe('SELECT 1 - -1')
    expect(minifySql('SELECT 1 -/* c */-1', pg).output).toBe('SELECT 1 - -1')
    expect(minifySql('SELECT 4 / /* c */ * 2', std).output).not.toContain('/*')
  })

  it('keeps optimizer hints and MySQL executable comments by default', () => {
    const r = minifySql('SELECT /*+ INDEX(t idx) */ a FROM t /*!40001 SQL_NO_CACHE */', my)
    expect(r.output).toBe('SELECT /*+ INDEX(t idx) */ a FROM t /*!40001 SQL_NO_CACHE */')
    expect(r.keptHints).toBe(2)
    expect(minifySql('SELECT /*+ X */ 1', { ...my, keepHints: false }).output).toBe('SELECT 1')
  })

  it('keeps T-SQL GO batch separators on their own line', () => {
    const r = minifySql('CREATE TABLE a (id int)\nGO\nSELECT  1\ngo 2\n', ts)
    expect(r.output).toBe('CREATE TABLE a(id int)\nGO\nSELECT 1\ngo 2')
  })

  it('optionally puts statements on separate lines', () => {
    expect(minifySql('SELECT 1;  SELECT 2;', { ...pg, statementPerLine: true }).output).toBe('SELECT 1;\nSELECT 2;')
  })

  it('throws a located error for unterminated literals', () => {
    expect(() => minifySql("SELECT 'abc", pg)).toThrow(SqlLexError)
    try {
      minifySql('SELECT 1, "abc', pg)
    } catch (e) {
      expect((e as SqlLexError).offset).toBe(10)
    }
    expect(() => minifySql('SELECT $$ abc', pg)).toThrow(/dollar-quoted/)
    expect(() => minifySql('SELECT /* abc', pg)).toThrow(/block comment/)
  })

  it('handles empty input and unicode', () => {
    expect(minifySql('', pg).output).toBe('')
    expect(minifySql("SELECT  'café  ☕'  AS  \"naïve col\"", pg).output).toBe("SELECT 'café  ☕' AS \"naïve col\"")
  })

  it('preserves every protected segment on a large generated script', () => {
    const parts: string[] = []
    for (let i = 0; i < 3000; i++) {
      parts.push(`-- row ${i}\nINSERT INTO "T ${i % 7}" (a, b)\n  VALUES ('x  ${i} -- y', $q$ /* ${i} */ $q$);`)
    }
    const sql = parts.join('\n\n')
    const t0 = performance.now()
    const r = minifySql(sql, pg)
    expect(performance.now() - t0).toBeLessThan(8000)
    expect(protectedSegments(r.output, pg)).toEqual(protectedSegments(sql, pg))
    expect(r.removedComments).toBe(3000)
  })
})

describe('lexSql', () => {
  it('keeps every byte', () => {
    const sql = "SELECT a.\"b c\", 'x' -- c\nFROM [t] /* z */ WHERE y = $1"
    expect(lexSql(sql, std).map((t) => t.text).join('')).toBe(sql)
  })
})

describe('formatSql', () => {
  it('formats with the selected options', () => {
    const r = formatSql('select a, b from t where x = 1 and y = 2', { ...DEFAULT_SQL_FORMAT, keywordCase: 'upper' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.output).toContain('SELECT')
      expect(r.output).toContain('\n  a,')
    }
  })

  it('supports tabs and lowercase keywords', () => {
    const r = formatSql('SELECT a FROM t', { ...DEFAULT_SQL_FORMAT, keywordCase: 'lower', indent: 'tab' })
    expect(r.ok && r.output).toBe('select\n\ta\nfrom\n\tt')
  })

  it('reports parse errors with location', () => {
    const r = formatSql('SELECT * FROM t WHERE (a = 1', DEFAULT_SQL_FORMAT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.line).toBe(1)
      expect(r.error.column).toBe(29)
      expect(r.error.message).toMatch(/end of query/)
    }
  })

  it('describes generic errors', () => {
    expect(describeSqlError(new Error('Parse error at token: ] at line 2 column 3\nlots of grammar'))).toMatchObject({ line: 2, column: 3, message: expect.stringContaining('Unexpected “]”') })
  })
})
