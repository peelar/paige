import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

import { evalSlackAuth } from "../../repositories/configuration/eval-auth";

export default eveChannel({
  auth: [evalSlackAuth(), vercelOidc(), localDev(), placeholderAuth()],
});
