/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SAMPLE_INDEX_METRICS_V1 = `
Index Utilization Information
  Utilized Single Indexes
    Index Spec: /name/?
    Index Impact Score: High
    ---
    Index Spec: /age/?
    Index Impact Score: High
    ---
    Index Spec: /town/?
    Index Impact Score: High
    ---
    Index Spec: /timestamp/?
    Index Impact Score: High
    ---
  Potential Single Indexes
  Utilized Composite Indexes
  Potential Composite Indexes
    Index Spec: /name ASC, /town ASC, /age ASC
    Index Impact Score: High
    ---
    Index Spec: /name ASC, /town ASC, /timestamp ASC
    Index Impact Score: High
    ---` as const;

export const SAMPLE_INDEX_METRICS_V2 = `
{
  "UtilizedIndexes": {
    "SingleIndexes": [
      {
        "IndexSpec": "/name/?",
        "IndexImpactScore": "High"
      },
      {
        "IndexSpec": "/age/?",
        "IndexImpactScore": "High"
      },
      {
        "IndexSpec": "/town/?",
        "IndexImpactScore": "High"
      },
      {
        "IndexSpec": "/timestamp/?",
        "IndexImpactScore": "High"
      }
    ],
    "CompositeIndexes": []
  },
  "PotentialIndexes": {
    "SingleIndexes": [],
    "CompositeIndexes": [
      {
        "IndexSpecs": [
          "/name ASC",
          "/town ASC",
          "/age ASC"
        ],
        "IndexImpactScore": "High"
      },
      {
        "IndexSpecs": [
          "/name ASC",
          "/town ASC",
          "/timestamp ASC"
        ],
        "IndexImpactScore": "High"
      }
    ]
  }
}` as const;
