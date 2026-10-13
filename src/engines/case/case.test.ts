import { describe, expect, it } from 'vitest'
import { convertCase, detectLineStyle, detectStyles, renameIdentifiers, splitWords, transliterate, type CaseId } from './index'

const c = (text: string, id: CaseId, o = {}) => convertCase(text, id, o)

describe('spec examples (hello world example)', () => {
  const table: [CaseId, string][] = [
    ['lower', 'hello world example'],
    ['upper', 'HELLO WORLD EXAMPLE'],
    ['title', 'Hello World Example'],
    ['sentence', 'Hello world example'],
    ['camel', 'helloWorldExample'],
    ['pascal', 'HelloWorldExample'],
    ['snake', 'hello_world_example'],
    ['screaming-snake', 'HELLO_WORLD_EXAMPLE'],
    ['kebab', 'hello-world-example'],
    ['screaming-kebab', 'HELLO-WORLD-EXAMPLE'],
    ['train', 'Hello-World-Example'],
    ['dot', 'hello.world.example'],
    ['path', 'hello/world/example'],
    ['space', 'hello world example'],
    ['alternating', 'hElLo WoRlD eXaMpLe'],
    ['inverse', 'hELLO wORLD eXAMPLE'],
    ['capitalize-words', 'Hello World Example'],
    ['toggle', 'HELLO WORLD EXAMPLE'],
  ]
  for (const [id, expected] of table) it(id, () => expect(c('hello world example', id)).toBe(expected))
})

describe('word splitting', () => {
  const words = (s: string, sep = false) => splitWords(s, sep).map((w) => w.text)
  it('splits camel and pascal', () => expect(words('helloWorldExample')).toEqual(['hello', 'World', 'Example']))
  it('splits acronym runs', () => expect(words('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']))
  it('splits trailing acronyms', () => expect(words('parseHTTPResponse')).toEqual(['parse', 'HTTP', 'Response']))
  it('treats punctuation as separators', () => expect(words('foo_bar-baz.qux/quux zap')).toEqual(['foo', 'bar', 'baz', 'qux', 'quux', 'zap']))
  it('keeps digits attached by default', () => expect(words('version2Api')).toEqual(['version2', 'Api']))
  it('separates digits when asked', () => expect(words('version2api', true)).toEqual(['version', '2', 'api']))
  it('drops apostrophes inside words', () => expect(words("don't stop")).toEqual(['dont', 'stop']))
  it('handles accented and non-Latin letters', () => {
    expect(words('crème brûlée')).toEqual(['crème', 'brûlée'])
    expect(words('приветМир')).toEqual(['привет', 'Мир'])
  })
  it('segments CJK text', () => expect(words('東京タワー').length).toBeGreaterThanOrEqual(1))
})

describe('acronym handling', () => {
  it('normalizes acronyms by default', () => {
    expect(c('XMLHttpRequest', 'camel')).toBe('xmlHttpRequest')
    expect(c('XMLHttpRequest', 'pascal')).toBe('XmlHttpRequest')
    expect(c('parseHTTPResponse', 'camel')).toBe('parseHttpResponse')
  })
  it('preserves acronyms when requested', () => {
    const o = { acronyms: 'preserve' as const }
    expect(c('XMLHttpRequest', 'pascal', o)).toBe('XMLHttpRequest')
    expect(c('XMLHttpRequest', 'camel', o)).toBe('xmlHttpRequest')
    expect(c('parseHTTPResponse', 'camel', o)).toBe('parseHTTPResponse')
    expect(c('parse HTTP response', 'pascal', o)).toBe('ParseHTTPResponse')
    expect(c('XMLHttpRequest', 'snake', o)).toBe('xml_http_request')
  })
  it('does not treat all-caps lines as acronyms', () => {
    expect(c('HELLO WORLD', 'camel', { acronyms: 'preserve' })).toBe('helloWorld')
  })
  it('applies a custom acronym list', () => {
    expect(c('user id', 'camel', { acronymList: ['ID'] })).toBe('userID')
    expect(c('api url', 'pascal', { acronymList: ['api', 'URL'] })).toBe('APIURL')
  })
})

describe('identifier conversion scope', () => {
  it('converts each line independently and keeps indentation', () => {
    expect(c('first name\n  last name\n\nemail address', 'snake')).toBe('first_name\n  last_name\n\nemail_address')
  })
  it('preserves CRLF line endings', () => expect(c('a b\r\nc d', 'kebab')).toBe('a-b\r\nc-d'))
  it('treats whole text as one identifier when scope=whole', () => expect(c('first name\nlast name', 'camel', { scope: 'whole' })).toBe('firstNameLastName'))
  it('converts between conventions', () => {
    expect(c('user_profile_id', 'camel')).toBe('userProfileId')
    expect(c('userProfileId', 'screaming-snake')).toBe('USER_PROFILE_ID')
    expect(c('USER_PROFILE_ID', 'kebab')).toBe('user-profile-id')
    expect(c('user-profile-id', 'pascal')).toBe('UserProfileId')
    expect(c('UserProfileId', 'dot')).toBe('user.profile.id')
  })
})

describe('text formats', () => {
  it('title case keeps minor words lowercase', () => {
    expect(c('the lord of the rings', 'title')).toBe('The Lord of the Rings')
    expect(c('a tale of two cities: the end', 'title')).toBe('A Tale of Two Cities: The End')
    expect(c('what are you looking at', 'title')).toBe('What Are You Looking At')
  })
  it('title case "all" style capitalises every word', () => expect(c('the lord of the rings', 'title', { titleStyle: 'all' })).toBe('The Lord Of The Rings'))
  it('title case keeps inner-cap brand words', () => expect(c('my iPhone and JavaScript', 'title')).toBe('My iPhone and JavaScript'))
  it('title case lowercases shouting unless preserving acronyms', () => {
    expect(c('the NASA mission', 'title')).toBe('The Nasa Mission')
    expect(c('the NASA mission', 'title', { acronyms: 'preserve' })).toBe('The NASA Mission')
  })
  it('sentence case handles multiple sentences, lines and the pronoun I', () => {
    expect(c('HELLO THERE. how are you? i am fine!\nnew line here', 'sentence')).toBe('Hello there. How are you? I am fine!\nNew line here')
  })
  it('sentence case does not split on decimals or abbreviations without space', () => {
    expect(c('PI IS 3.14 AND e.g.something', 'sentence')).toBe('Pi is 3.14 and e.g.something')
  })
  it('capitalize sentences leaves other letters', () => expect(c('hello WORLD. another one', 'capitalize-sentences')).toBe('Hello WORLD. Another one'))
  it('uncapitalize words', () => expect(c('Hello World Example', 'uncapitalize-words')).toBe('hello world example'))
  it('toggle case swaps every letter', () => expect(c('Hello World 123', 'toggle')).toBe('hELLO wORLD 123'))
  it('preserves punctuation and whitespace in text formats', () => expect(c('  hi,\tthere!  ', 'upper')).toBe('  HI,\tTHERE!  '))
})

describe('locale-sensitive casing', () => {
  it('Turkish dotted and dotless i', () => {
    expect(c('istanbul', 'upper', { locale: 'tr' })).toBe('İSTANBUL')
    expect(c('ISPARTA', 'lower', { locale: 'tr' })).toBe('ısparta')
    expect(c('istanbul', 'upper')).toBe('ISTANBUL')
  })
  it('Dutch IJ digraph', () => {
    expect(c('ijsland', 'title', { locale: 'nl' })).toBe('IJsland')
    expect(c('ijs is koud', 'sentence', { locale: 'nl' })).toBe('IJs is koud')
  })
  it('German sharp s uppercases to SS', () => expect(c('straße', 'upper')).toBe('STRASSE'))
  it('handles astral code points without corruption', () => expect(c('𝒽ello world', 'title')).toBe('𝒽ello World'))
})

describe('style detection', () => {
  it('detects identifier styles', () => {
    expect(detectLineStyle('helloWorld')).toBe('camel')
    expect(detectLineStyle('HelloWorld')).toBe('pascal')
    expect(detectLineStyle('XMLHttpRequest')).toBe('pascal')
    expect(detectLineStyle('hello_world')).toBe('snake')
    expect(detectLineStyle('HELLO_WORLD')).toBe('screaming-snake')
    expect(detectLineStyle('hello-world')).toBe('kebab')
    expect(detectLineStyle('Hello-World')).toBe('train')
    expect(detectLineStyle('hello.world')).toBe('dot')
    expect(detectLineStyle('hello/world')).toBe('path')
  })
  it('detects prose styles', () => {
    expect(detectLineStyle('Hello World Example')).toBe('title')
    expect(detectLineStyle('Hello world example')).toBe('sentence')
    expect(detectLineStyle('HELLO WORLD')).toBe('upper')
    expect(detectLineStyle('hello world')).toBe('lower')
  })
  it('summarises the dominant style', () => {
    const s = detectStyles('foo_bar\nbaz_qux\nquuxCorge\n')
    expect(s.dominant).toBe('snake')
    expect(s.counts.snake).toBe(2)
  })
})

describe('identifier renaming in code', () => {
  it('renames only identifiers in the source convention', () => {
    const src = 'const user_name = get_user(user_id); return userName'
    const r = renameIdentifiers(src, { from: 'snake', to: 'camel', skipStringsAndComments: true })
    expect(r.text).toBe('const userName = getUser(userId); return userName')
    expect(r.count).toBe(3)
  })
  it('skips strings and comments when asked', () => {
    const src = 'my_var = "keep_me" // also_keep\nother_var'
    expect(renameIdentifiers(src, { from: 'snake', to: 'camel', skipStringsAndComments: true }).text).toBe('myVar = "keep_me" // also_keep\notherVar')
    expect(renameIdentifiers(src, { from: 'snake', to: 'camel', skipStringsAndComments: false }).text).toBe('myVar = "keepMe" // alsoKeep\notherVar')
  })
  it('keeps leading underscores', () => expect(renameIdentifiers('_private_field', { from: 'snake', to: 'camel', skipStringsAndComments: true }).text).toBe('_privateField'))
})

describe('transliteration', () => {
  it('strips diacritics and maps special letters', () => {
    expect(transliterate('Crème Brûlée à São Paulo')).toBe('Creme Brulee a Sao Paulo')
    expect(transliterate('Straße Øresund Łódź')).toBe('Strasse Oresund Lodz')
    expect(transliterate('Привет мир')).toBe('Privet mir')
  })
  it('optionally uses German umlaut spelling', () => expect(transliterate('Müller Öl', { german: true })).toBe('Mueller Oel'))
})

describe('large input', () => {
  it('converts 100k lines in reasonable time', () => {
    const text = Array.from({ length: 100_000 }, (_, i) => `user profile field ${i}`).join('\n')
    const t = performance.now()
    const out = c(text, 'camel')
    const ms = performance.now() - t
    expect(out.split('\n')[99_999]).toBe('userProfileField99999')
    expect(ms).toBeLessThan(5000)
  })
})
