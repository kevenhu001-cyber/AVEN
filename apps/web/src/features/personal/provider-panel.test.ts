import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@aven/api-client';
import { ProviderPanel } from './provider-panel';
const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  saveProvider: vi.fn(),
  testProvider: vi.fn(),
  deleteProvider: vi.fn(),
  changed: vi.fn(),
  expired: vi.fn(),
}));
vi.mock('@aven/api-client', async () => ({
  ...(await vi.importActual('@aven/api-client')),
  createApiClient: () => ({ agent: mocks }),
}));
vi.mock('./api', () => ({
  authExpired: () => false,
  errorText: () => '请求失败',
  webCall: () => ({ auth: { kind: 'web', csrfToken: 'synthetic-csrf' } }),
}));
const metadata = {
  configId: '7334898a-e664-4b76-8499-d96d1ccc3746',
  baseUrl: 'https://api.channel.org/v1',
  model: 'channel-model',
  version: 1,
  updatedAt: '2026-11-13T00:00:00.000Z',
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.provider.mockResolvedValue(null);
  mocks.saveProvider.mockResolvedValue(metadata);
  mocks.testProvider.mockResolvedValue({ ok: true });
  mocks.deleteProvider.mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(
      createElement(ProviderPanel, { onExpired: mocks.expired, onChanged: mocks.changed }),
    );
  });
}
async function fill(id: string, value: string) {
  await act(async () => renderer.root.findByProps({ id }).props.onChange({ target: { value } }));
}
function button(text: string) {
  const found = renderer.root.findAllByType('button').find((node) => node.props.children === text);
  if (!found) throw new Error('Missing button ' + text);
  return found;
}
async function newInput() {
  await fill('provider-url', metadata.baseUrl);
  await fill('provider-model', metadata.model);
  await fill('provider-key', 'synthetic-user-secret');
}
describe('model channel settings', () => {
  it('saves the user channel and clears the key from the form afterwards', async () => {
    await mount();
    await newInput();
    await act(async () =>
      renderer.root
        .findByProps({ className: 'stack-form provider-form' })
        .props.onSubmit({ preventDefault() {} }),
    );
    expect(mocks.saveProvider.mock.calls[0]?.[0]).toEqual({
      baseUrl: metadata.baseUrl,
      model: metadata.model,
      apiKey: 'synthetic-user-secret',
      expectedVersion: 0,
      expectedConfigId: null,
    });
    expect(renderer.root.findByProps({ id: 'provider-key' }).props.value).toBe('');
    expect(mocks.changed).toHaveBeenCalledTimes(1);
  });
  it('retains the encrypted saved key when editing without a new key', async () => {
    mocks.provider.mockResolvedValue(metadata);
    await mount();
    await fill('provider-model', 'updated-model');
    await act(async () =>
      renderer.root
        .findByProps({ className: 'stack-form provider-form' })
        .props.onSubmit({ preventDefault() {} }),
    );
    expect(mocks.saveProvider.mock.calls[0]?.[0]).toEqual({
      baseUrl: metadata.baseUrl,
      model: 'updated-model',
      expectedVersion: 1,
      expectedConfigId: metadata.configId,
    });
    expect(renderer.root.findByProps({ id: 'provider-key' }).props.type).toBe('password');
  });
  it('tests the draft without saving and explains upstream limitations', async () => {
    mocks.testProvider.mockResolvedValue({ ok: false, errorCode: 'PROVIDER_RATE_LIMITED' });
    await mount();
    await newInput();
    await act(async () => button('测试连接').props.onClick());
    expect(mocks.saveProvider).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('额度');
  });
  it('requires confirmation and includes immutable identity when deleting', async () => {
    mocks.provider.mockResolvedValue(metadata);
    await mount();
    await act(async () => button('删除个人渠道').props.onClick());
    expect(mocks.deleteProvider).not.toHaveBeenCalled();
    await act(async () => button('确认删除并恢复默认').props.onClick());
    expect(mocks.deleteProvider).toHaveBeenCalledWith(1, metadata.configId, expect.anything());
    expect(renderer.root.findByProps({ id: 'provider-key' }).props.required).toBe(true);
  });
  it('reloads on optimistic conflict instead of overwriting another device', async () => {
    mocks.provider
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce({ ...metadata, version: 2, model: 'other-device-model' });
    mocks.saveProvider.mockRejectedValue(new ApiClientError('HTTP_ERROR', 409));
    await mount();
    await fill('provider-model', 'my-edit');
    await act(async () =>
      renderer.root
        .findByProps({ className: 'stack-form provider-form' })
        .props.onSubmit({ preventDefault() {} }),
    );
    expect(renderer.root.findByProps({ id: 'provider-model' }).props.value).toBe(
      'other-device-model',
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('配置已在其他位置变更');
    expect(mocks.saveProvider).toHaveBeenCalledTimes(1);
  });
});
