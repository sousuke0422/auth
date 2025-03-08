import { createStorage } from "unstorage";
import lruCacheDriver from "unstorage/drivers/lru-cache";

export const misskeyAuthStorage = createStorage({
    driver: lruCacheDriver({}),
})