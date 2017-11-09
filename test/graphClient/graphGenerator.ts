/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const nodesCount = 250;
const aveConnectionsPerNode = 100;

var femaleFirstNames = createRandomNames(100);
var maleFirstNames = createRandomNames(100);
var lastNames = createRandomNames(100);

function createRandomName(): string {
  return (Math.floor(Math.random() * 999999)).toString(16);
}

function createRandomNames(n: number): string[] {
  var names: string[] = [];
  for (var i = 0; i < n; ++i) {
    names.push(createRandomName());
  }

  return names;
}

class Person {
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  isMale: boolean;
}

/* example:

        {
            "id": "Aubrey Leslie",
            "label": "person",
            "type": "vertex",
            "properties": {
                "firstName": [
                    {
                        "id": "bc0b2ad6-ae07-48f1-86cd-020ae5a3dfa7",
                        "value": "Aubrey"
                    }
                ],
                "lastName": [
                    {
                        "id": "5569ee9d-33ff-4ff4-abcb-61c73878639d",
                        "value": "Leslie"
                    }
                ],
                "age": [
                    {
                        "id": "98f04971-0635-4751-8bb6-661e9e5e1668",
                        "value": "1"
                    }
                ],
                "isMale": [
                    {
                        "id": "b4cdf995-e876-4421-a0e0-cc26ca2e7d84",
                        "value": "true"
                    }
                ]
            }
        },
*/
class Vertex {
  id: string;
  label: string;
  type: "vertex";
  properties: { [key: string]: [{ id: string, value: string }] };
}

/* example:

  {
    "id": "6fcc7343-bb75-4eef-ae54-9a11e83399e8",
    "label": "knows",
    "type": "edge",
    "inVLabel": "person",
    "outVLabel": "person",
    "inV": "Ricky Corcoran",
    "outV": "Ricky Corcoran"
  },
*/
class Edge {
  id: string;
  label: string;
  type: "edge";
  inVLabel: string;
  outVLabel: string;
  inV: string;
  outV: string;
}

function getRandomItem<T>(array: T[]): T {
  var n = Math.floor(Math.random() * array.length);
  return array[n];
}

function createPerson(): Person {
  var p = new Person();
  p.isMale = (Math.random() < .5);
  p.firstName = p.isMale ? getRandomItem(maleFirstNames) : getRandomItem(femaleFirstNames);
  p.lastName = getRandomItem(lastNames);
  p.id = p.firstName + " " + p.lastName;
  p.age = Math.floor(Math.random() * 100 + 1);

  return p;
}

export function createGraph(): [Vertex[], Edge[]] {
  var people: Person[] = [];
  var edges: Edge[] = [];

  for (var i = 0; i < nodesCount; ++i) {
    try {
      var p = createPerson();
      while (people.find(p2 => p.id === p2.id)) {
        p = createPerson();
      }

      people.push(p);
    } catch (error) {
      console.error(error);
    }
  }

  for (var i = 0; i < nodesCount * aveConnectionsPerNode; ++i) {
    var p1 = getRandomItem(people);
    var p2 = getRandomItem(people);
    if (Math.random() < .1) {
      p2 = p1;
    }

    edges.push({
      id: i.toString(),
      type: "edge",
      label: "knows",
      inV: p1.id,
      outV: p2.id,
      inVLabel: "person",
      outVLabel: "person"
    });
  }

  var vertices = people.map(p => <Vertex>{
    id: p.id,
    type: "vertex",
    label: "person",
    properties: {
      firstName: [
        {
          id: "bc0b2ad6-ae07-48f1-86cd-020ae5a3dfa7",
          value: p.firstName
        }
      ],
      lastName: [
        {
          id: "5569ee9d-33ff-4ff4-abcb-61c73878639d",
          value: p.lastName
        }
      ],
      age: [
        {
          id: "98f04971-0635-4751-8bb6-661e9e5e1668",
          value: p.age.toString()
        }
      ],
      isMale: [
        {
          id: "b4cdf995-e876-4421-a0e0-cc26ca2e7d84",
          value: p.isMale ? "true" : "false"
        }
      ]
    }
  });

  return [vertices, edges];
}
