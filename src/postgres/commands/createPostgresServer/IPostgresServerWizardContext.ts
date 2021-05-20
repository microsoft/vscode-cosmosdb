/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sku } from "@azure/arm-postgresql/esm/models";
import { Server } from "@azure/arm-postgresql/src/models";
import { IAzureDBWizardContext } from "../../../tree/IAzureDBWizardContext";

export interface IPostgresServerWizardContext extends IAzureDBWizardContext {
  /**
   * Username without server, i.e. "user1"
   */
  shortUserName?: string;
  /**
   * Username with server, i.e. "user1@server1"
   */
  longUserName?: string;
  adminPassword?: string;

  addFirewall?: boolean;
  publicIp?: string;

  server?: Server;
  sku?: Sku;
}
