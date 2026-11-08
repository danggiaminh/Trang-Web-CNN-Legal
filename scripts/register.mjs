// Bộ phân giải module của site cho script build. Khác tests/register.mjs: không chặn mạng, vì script cần gọi API.
import { register } from "node:module";

register("../tests/loader.mjs", import.meta.url);
