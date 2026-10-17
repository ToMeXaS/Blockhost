import { describe, expect, it } from 'vitest'
import { SERVER_TYPES } from '../../shared/types'
import { fakeProviderDeps } from '../test-utils'
import { createProviders } from './index'

describe('createProviders', () => {
  it('registers one provider per server type', () => {
    const providers = createProviders(fakeProviderDeps({}).deps)
    for (const type of SERVER_TYPES) expect(providers[type].type).toBe(type)
  })
})
