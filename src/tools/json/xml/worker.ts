import { expose } from '@/workers/rpc'
import { jsonToXml, xmlToJson, type JsonToXmlOptions, type XmlToJsonOptions } from '@/engines/data/xml'

export const tasks = {
  xmlToJson: ({ text, opts }: { text: string; opts: XmlToJsonOptions }) => xmlToJson(text, opts),
  jsonToXml: ({ text, opts }: { text: string; opts: JsonToXmlOptions }) => jsonToXml(text, opts),
}
export type Tasks = typeof tasks
expose(tasks)
