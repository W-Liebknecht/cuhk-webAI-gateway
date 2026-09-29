// The adapter lives outside the OpenCLI checkout, so package self-references
// such as "@jackwener/opencli/registry" cannot resolve from this real path.
// Keep the coupling explicit and limited to this compatibility module.
export { cli, Strategy } from '../../cuhk-ai-opencli/dist/src/registry-api.js';
export {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '../../cuhk-ai-opencli/dist/src/errors.js';
