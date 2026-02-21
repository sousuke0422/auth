import { createStorage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

export const misskeyAuthStorage = createStorage({
    driver: lruCacheDriver({}),
})

export const oidcSessionStorage = createStorage({
    // todo: redis
    driver: lruCacheDriver({
        ttl: 3600
    }),
})