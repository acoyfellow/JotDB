export { JotDB } from './index'

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }) {
    return env.ASSETS.fetch(request)
  },
}
