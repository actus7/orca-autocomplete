import {
  atom,
  Badge,
  Button,
  Heading,
  Input,
  plugin,
  read,
  Row,
  set,
  Stack,
  Text,
  type PanelContext
} from 'orca'

const draftKey = atom('')
const hasKey = atom(false)
const result = atom<{ ok: boolean; message: string } | null>(null)
const busy = atom(false)

async function saveKey(): Promise<void> {
  const saved = await plugin.request('key.set', { key: read(draftKey) })
  set(hasKey, saved.hasKey)
  set(draftKey, '')
}

async function testProvider(): Promise<void> {
  set(busy, true)
  set(result, null)
  try {
    set(result, await plugin.request('provider.test', {}))
  } catch (error) {
    set(result, { ok: false, message: error instanceof Error ? error.message : String(error) })
  } finally {
    set(busy, false)
  }
}

/** Runs once before the first render. */
export function setup(_ctx: PanelContext): void {
  void plugin
    .request('key.status', {})
    .then((status) => set(hasKey, status.hasKey))
    .catch(() => undefined)
}

export default function Panel() {
  const outcome = read(result)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Autocomplete</Heading>
        <Badge tone={read(hasKey) ? 'success' : 'neutral'}>
          {read(hasKey) ? 'Key saved' : 'No key'}
        </Badge>
      </Row>
      <Text>
        Pick the provider, base URL and model in Settings → Plugins → Autocomplete. The key is kept
        encrypted and only sent to that base URL. Leave it empty for local servers.
      </Text>
      <Input
        label="API key"
        type="password"
        placeholder={read(hasKey) ? 'Enter a new key to replace it' : 'sk-...'}
        value={read(draftKey)}
        onChange={(value) => set(draftKey, value)}
        onSubmit={() => void saveKey()}
      />
      <Row gap="xs">
        <Button onPress={() => void saveKey()}>Save key</Button>
        <Button variant="outline" disabled={read(busy)} onPress={() => void testProvider()}>
          {read(busy) ? 'Testing…' : 'Test connection'}
        </Button>
      </Row>
      {outcome ? <Text tone={outcome.ok ? 'success' : 'danger'}>{outcome.message}</Text> : null}
    </Stack>
  )
}
