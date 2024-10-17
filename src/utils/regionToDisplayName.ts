/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regionDisplayNames: { [key: string]: string } = {
    eastus: 'East US',
    southcentralus: 'South Central US',
    westus2: 'West US 2',
    westus3: 'West US 3',
    australiaeast: 'Australia East',
    southeastasia: 'Southeast Asia',
    northeurope: 'North Europe',
    swedencentral: 'Sweden Central',
    uksouth: 'UK South',
    westeurope: 'West Europe',
    centralus: 'Central US',
    southafricanorth: 'South Africa North',
    centralindia: 'Central India',
    eastasia: 'East Asia',
    japaneast: 'Japan East',
    koreacentral: 'Korea Central',
    canadacentral: 'Canada Central',
    francecentral: 'France Central',
    germanywestcentral: 'Germany West Central',
    italynorth: 'Italy North',
    norwayeast: 'Norway East',
    polandcentral: 'Poland Central',
    spaincentral: 'Spain Central',
    switzerlandnorth: 'Switzerland North',
    mexicocentral: 'Mexico Central',
    uaenorth: 'UAE North',
    brazilsouth: 'Brazil South',
    israelcentral: 'Israel Central',
    qatarcentral: 'Qatar Central',
    centralusstage: 'Central US (Stage)',
    eastusstage: 'East US (Stage)',
    eastus2stage: 'East US 2 (Stage)',
    northcentralusstage: 'North Central US (Stage)',
    southcentralusstage: 'South Central US (Stage)',
    westusstage: 'West US (Stage)',
    westus2stage: 'West US 2 (Stage)',
    asia: 'Asia',
    asiapacific: 'Asia Pacific',
    australia: 'Australia',
    brazil: 'Brazil',
    canada: 'Canada',
    europe: 'Europe',
    france: 'France',
    germany: 'Germany',
    global: 'Global',
    india: 'India',
    israel: 'Israel',
    italy: 'Italy',
    japan: 'Japan',
    korea: 'Korea',
    newzealand: 'New Zealand',
    norway: 'Norway',
    poland: 'Poland',
    qatar: 'Qatar',
    singapore: 'Singapore',
    southafrica: 'South Africa',
    sweden: 'Sweden',
    switzerland: 'Switzerland',
    uae: 'United Arab Emirates',
    uk: 'United Kingdom',
    unitedstates: 'United States',
    unitedstateseuap: 'United States EUAP',
    eastasiastage: 'East Asia (Stage)',
    southeastasiastage: 'Southeast Asia (Stage)',
    brazilus: 'Brazil US',
    eastus2: 'East US 2',
    eastusstg: 'East US STG',
    northcentralus: 'North Central US',
    westus: 'West US',
    japanwest: 'Japan West',
    jioindiawest: 'Jio India West',
    centraluseuap: 'Central US EUAP',
    eastus2euap: 'East US 2 EUAP',
    southcentralusstg: 'South Central US STG',
    westcentralus: 'West Central US',
    southafricawest: 'South Africa West',
    australiacentral: 'Australia Central',
    australiacentral2: 'Australia Central 2',
    australiasoutheast: 'Australia Southeast',
    jioindiacentral: 'Jio India Central',
    koreasouth: 'Korea South',
    southindia: 'South India',
    westindia: 'West India',
    canadaeast: 'Canada East',
    francesouth: 'France South',
    germanynorth: 'Germany North',
    norwaywest: 'Norway West',
    switzerlandwest: 'Switzerland West',
    ukwest: 'UK West',
    uaecentral: 'UAE Central',
    brazilsoutheast: 'Brazil Southeast',
    // Add other regions as necessary
};

export function regionToDisplayName(region: string): string {
    /**
     * TODO: this can be improved by discovering a miss, and then lookign up the correct values
     * via a REST api + updating local cache of regions, as a separate package, to be shared.
     *
     * REST API: GET https://management.azure.com/subscriptions/{subscriptionId}/locations?api-version=2021-01-01
     * This will return a list of regions with both name (region code) and displayName (user-friendly name).
     *
     * az rest --method get --url https://management.azure.com/subscriptions/{subscriptionId}/locations?api-version=2021-01-01
     */

    return `${regionDisplayNames[region]} (${region})` || region;
}
