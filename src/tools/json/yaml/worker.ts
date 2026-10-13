import { expose } from '@/workers/rpc'
import { jsonToYaml, yamlToJson, type JsonToYamlOptions, type YamlToJsonOptions } from '@/engines/data/yaml'

export const tasks = {
  yamlToJson: ({ text, opts }: { text: string; opts: YamlToJsonOptions }) => yamlToJson(text, opts),
  jsonToYaml: ({ text, opts }: { text: string; opts: JsonToYamlOptions }) => jsonToYaml(text, opts),
}
export type Tasks = typeof tasks
expose(tasks)
