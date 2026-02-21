import { Logger } from "tslog";
import { maskPlaceholder } from "./const";

export const honoLogger = new Logger({ name: 'API', type: 'pretty', maskPlaceholder })
