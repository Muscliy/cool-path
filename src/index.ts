import { Parser } from './parser'
import { isStr, isArr, isFn, isEqual, isObj, isNum } from './utils'
import {
  getDestructor,
  getInByDestructor,
  setInByDestructor,
  deleteInByDestructor,
  existInByDestructor
} from './destructor'
import { Segments, Node, Pattern } from './types'
export * from './types'
import { LRUMap } from './lru'
import { Matcher } from './matcher'
const pathCache = new LRUMap(1000)

const getIn = (segments: Segments, source: any) => {
  for (let i = 0; i < segments.length; i++) {
    let index = segments[i]
    const rules = getDestructor(index as string)
    if (!rules) {
      if (source === undefined || source === null) {
        if (i !== segments.length - 1) {
          return source
        }
        break
      }
      if (source === undefined) return
      source = source[index]
    } else {
      source = getInByDestructor(source, rules, { setIn, getIn })
      break
    }
  }
  return source
}

const setIn = (segments: Segments, source: any, value: any) => {
  for (let i = 0; i < segments.length; i++) {
    const index = segments[i]
    const rules = getDestructor(index as string)
    if (!rules) {
      if (source === undefined) return
      if (!isObj(source[index])) {
        if (source[index] === undefined && value === undefined) {
          return
        }
        if (isNum(segments[i + 1])) {
          source[index] = []
        } else {
          source[index] = {}
        }
      }

      if (i === segments.length - 1) {
        source[index] = value
      }

      source = source[index]
    } else {
      setInByDestructor(source, rules, value, { setIn, getIn })
      break
    }
  }
}

const deleteIn = (segments: Segments, source: any) => {
  for (let i = 0; i < segments.length; i++) {
    let index = segments[i]
    const rules = getDestructor(index as string)
    if (!rules) {
      if (i === segments.length - 1) {
        if (isArr(source)) {
          source.splice(Number(index), 1)
        } else {
          delete source[index]
        }
        return
      }

      if (source === undefined) return

      source = source[index]

      if (!isObj(source)) {
        return
      }
    } else {
      deleteInByDestructor(source, rules, {
        setIn,
        getIn,
        deleteIn
      })
      break
    }
  }
}

const existIn = (segments: Segments, source: any, start: number | Path) => {
  if (start instanceof Path) {
    start = start.length
  }
  for (let i = start; i < segments.length; i++) {
    let index = segments[i]
    const rules = getDestructor(index as string)
    if (!rules) {
      if (i === segments.length - 1) {
        if (index in source) {
          return true
        }
        return false
      }

      if (source === undefined) return false

      source = source[index]

      if (!isObj(source)) {
        return false
      }
    } else {
      return existInByDestructor(source, rules, start, {
        setIn,
        getIn,
        deleteIn,
        existIn
      })
    }
  }
}

export class Path {
  public entire: string
  public segments: Segments
  public isMatchPattern: boolean
  public isWildMatchPattern: boolean
  public tree: Node
  private matchCache: any
  private includesCache: any

  constructor(input: Pattern) {
    const {
      tree,
      segments,
      entire,
      isMatchPattern,
      isWildMatchPattern
    } = this.parse(input)
    this.entire = entire
    this.segments = segments
    this.isMatchPattern = isMatchPattern
    this.isWildMatchPattern = isWildMatchPattern
    this.tree = tree as Node
    this.matchCache = new LRUMap(200)
    this.includesCache = new LRUMap(200)
  }

  toString() {
    return this.entire
  }

  toArray() {
    return this.segments
  }

  get length() {
    return this.segments.length
  }

  private parse(pattern: Pattern) {
    if (pattern instanceof Path) {
      return {
        entire: pattern.entire,
        segments: pattern.segments.slice(),
        isWildMatchPattern: pattern.isWildMatchPattern,
        isMatchPattern: pattern.isMatchPattern,
        tree: pattern.tree
      }
    } else if (isStr(pattern)) {
      if (!pattern)
        return {
          entire: '',
          segments: [],
          isWildMatchPattern: false,
          isMatchPattern: false
        }
      const parser = new Parser(pattern)
      const tree = parser.parse()
      if (!parser.isMatchPattern) {
        const segments = parser.data.segments
        return {
          entire: segments.join('.'),
          segments,
          tree,
          isWildMatchPattern: false,
          isMatchPattern: false
        }
      } else {
        return {
          entire: pattern,
          segments: [],
          isWildMatchPattern: parser.isWildMatchPattern,
          isMatchPattern: true,
          tree
        }
      }
    } else if (isArr(pattern)) {
      return {
        entire: pattern.join('.'),
        segments: pattern.reduce((buf, key) => {
          return buf.concat(this.parseString(key))
        }, []),
        isWildMatchPattern: false,
        isMatchPattern: false
      }
    } else {
      return {
        entire: '',
        segments: pattern !== undefined ? [pattern] : [],
        isWildMatchPattern: false,
        isMatchPattern: false
      }
    }
  }

  private parseString(source: any) {
    if (isStr(source)) {
      source = source.replace(/\s*/g, '')
      try {
        const { segments, isMatchPattern } = this.parse(source)
        return !isMatchPattern ? segments : source
      } catch (e) {
        return source
      }
    }
    return source
  }

  concat = (...args: Array<string | number>) => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be concat`)
    }
    return Path.getPath(this.segments.concat(...args))
  }

  slice = (start?: number, end?: number) => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be slice`)
    }
    return Path.getPath(this.segments.slice(start, end))
  }

  push = (item: string | number) => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be push`)
    }
    item = this.parseString(item)
    this.segments.push(item)
    this.entire = this.segments.join('.')
    return this
  }

  pop = () => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be pop`)
    }
    this.segments.pop()
    this.entire = this.segments.join('.')
  }

  splice = (
    start: number,
    deleteCount?: number,
    ...items: Array<string | number>
  ) => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be splice`)
    }
    if (deleteCount === 0) {
      items = items.map(item => this.parseString(item))
    }
    this.segments.splice(start, deleteCount, ...items)
    this.entire = this.segments.join('.')
    return this
  }

  forEach = (callback: (key: string | number) => any) => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be each`)
    }
    this.segments.forEach(callback)
  }

  map = (callback: (key: string | number) => any) => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be map`)
    }
    return this.segments.map(callback)
  }

  reduce = <T>(
    callback: (buf: T, item: string | number, index: number) => T,
    initial: T
  ): T => {
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be reduce`)
    }
    return this.segments.reduce(callback, initial)
  }

  getNearestChildPathBy = (target?: Pattern) => {
    const path = Path.parse(target)
    if (path.length < this.length) return this
    return this.concat(path.segments[this.length])
  }

  parent = () => {
    return this.slice(0, this.length - 1)
  }

  includes = (pattern: Pattern) => {
    const { entire, segments, isMatchPattern } = Path.getPath(pattern)
    const cache = this.includesCache.get(entire)
    if (cache !== undefined) return cache
    const cacheWith = (value: boolean): boolean => {
      this.includesCache.set(entire, value)
      return value
    }
    if (this.isMatchPattern) {
      if (!isMatchPattern) {
        return cacheWith(this.match(segments))
      } else {
        throw new Error(`${this.entire} cannot be used to match ${entire}`)
      }
    }
    if (isMatchPattern) {
      throw new Error(`${this.entire} cannot be used to match ${entire}`)
    }
    if (segments.length > this.segments.length) return cacheWith(false)
    for (let i = 0; i < segments.length; i++) {
      if (!isEqual(segments[i], this.segments[i])) {
        return cacheWith(false)
      }
    }
    return cacheWith(true)
  }

  transform = <T>(
    regexp: string | RegExp,
    callback: (...args: string[]) => T
  ): T | string => {
    if (!isFn(callback)) return ''
    if (this.isMatchPattern) {
      throw new Error(`${this.entire} cannot be transformed`)
    }
    const args = this.segments.reduce((buf, key) => {
      return new RegExp(regexp).test(key as string) ? buf.concat(key) : buf
    }, [])
    return callback(...args)
  }

  match = (pattern: Pattern): boolean => {
    const path = Path.getPath(pattern)
    const cache = this.matchCache.get(path.entire)
    if (cache !== undefined) return cache
    const cacheWith = (value: boolean): boolean => {
      this.matchCache.set(path.entire, value)
      return value
    }
    if (path.isMatchPattern) {
      if (this.isMatchPattern) {
        throw new Error(`${path.entire} cannot match ${this.entire}`)
      } else {
        return cacheWith(path.match(this.segments))
      }
    } else {
      if (this.isMatchPattern) {
        return cacheWith(new Matcher(this.tree).match(path.segments))
      } else {
        return cacheWith(Matcher.matchSegments(this.segments, path.segments))
      }
    }
  }

  existIn = (source?: any, start: number | Path = 0) => {
    return existIn(this.segments, source, start)
  }

  getIn = (source?: any) => {
    return getIn(this.segments, source)
  }

  setIn = (source?: any, value?: any) => {
    setIn(this.segments, source, value)
    return source
  }

  deleteIn = (source?: any) => {
    deleteIn(this.segments, source)
    return source
  }

  static match(pattern: Pattern) {
    const path = Path.getPath(pattern)
    const matcher = target => {
      return path.match(target)
    }
    matcher.path = path
    return matcher
  }

  static transform<T>(
    pattern: Pattern,
    regexp: string | RegExp,
    callback: (...args: string[]) => T
  ): any {
    return Path.getPath(pattern).transform(regexp, callback)
  }

  static parse(path: Pattern = ''): Path {
    return Path.getPath(path)
  }

  static getPath(path: Pattern = ''): Path {
    if (path instanceof Path) {
      const found = pathCache.get(path.entire)
      if (found) {
        return found
      } else {
        pathCache.set(path.entire, path)
        return path
      }
    } else {
      const key = path.toString()
      const found = pathCache.get(key)
      if (found) {
        return found
      } else {
        path = new Path(path)
        pathCache.set(key, path)
        return path
      }
    }
  }

  static getIn = (source: any, pattern: Pattern) => {
    const path = Path.getPath(pattern)
    return path.getIn(source)
  }

  static setIn = (source: any, pattern: Pattern, value: any) => {
    const path = Path.getPath(pattern)
    return path.setIn(source, value)
  }

  static deleteIn = (source: any, pattern: Pattern) => {
    const path = Path.getPath(pattern)
    return path.deleteIn(source)
  }

  static existIn = (source: any, pattern: Pattern, start?: number | Path) => {
    const path = Path.getPath(pattern)
    return path.existIn(source, start)
  }
}

export default Path
