/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import _ from 'lodash';
import expect from '@kbn/expect';
import {
  ChildNode,
  LifecycleNode,
  ResolverAncestry,
  ResolverEvent,
  ResolverRelatedEvents,
  ResolverChildren,
  ResolverTree,
  LegacyEndpointEvent,
  ResolverNodeStats,
} from '../../../../plugins/security_solution/common/endpoint/types';
import { parentEntityId } from '../../../../plugins/security_solution/common/endpoint/models/event';
import { FtrProviderContext } from '../../ftr_provider_context';
import {
  Event,
  Tree,
  TreeNode,
  RelatedEventCategory,
  RelatedEventInfo,
  categoryMapping,
} from '../../../../plugins/security_solution/common/endpoint/generate_data';
import { Options, GeneratedTrees } from '../../services/resolver';

/**
 * Check that the given lifecycle is in the resolver tree's corresponding map
 *
 * @param node a lifecycle node containing the start and end events for a node
 * @param nodeMap a map of entity_ids to nodes to look for the passed in `node`
 */
const expectLifecycleNodeInMap = (node: LifecycleNode, nodeMap: Map<string, TreeNode>) => {
  const genNode = nodeMap.get(node.entityID);
  expect(genNode).to.be.ok();
  compareArrays(genNode!.lifecycle, node.lifecycle, true);
};

/**
 * Verify that all the ancestor nodes including the origin are valid.
 *
 * @param origin the origin node for the tree
 * @param ancestors an array of ancestors
 * @param tree the generated resolver tree as the source of truth
 * @param verifyLastParent a boolean indicating whether to check the last ancestor. If the ancestors array intentionally
 *  does not contain all the ancestors, the last one will not have the parent
 */
const verifyAncestryFromOrigin = (
  origin: LifecycleNode,
  ancestors: LifecycleNode[],
  tree: Tree,
  verifyLastParent: boolean
) => {
  compareArrays(tree.origin.lifecycle, origin.lifecycle, true);
  verifyAncestry(ancestors, tree, verifyLastParent);
};

/**
 * Verify that all the ancestor nodes are valid and optionally have parents.
 *
 * @param ancestors an array of ancestors
 * @param tree the generated resolver tree as the source of truth
 * @param verifyLastParent a boolean indicating whether to check the last ancestor. If the ancestors array intentionally
 *  does not contain all the ancestors, the last one will not have the parent
 */
const verifyAncestry = (ancestors: LifecycleNode[], tree: Tree, verifyLastParent: boolean) => {
  // group the ancestors by their entity_id mapped to a lifecycle node
  const groupedAncestors = _.groupBy(ancestors, (ancestor) => ancestor.entityID);
  // group by parent entity_id
  const groupedAncestorsParent = _.groupBy(ancestors, (ancestor) =>
    parentEntityId(ancestor.lifecycle[0])
  );
  // make sure there aren't any nodes with the same entity_id
  expect(Object.keys(groupedAncestors).length).to.eql(ancestors.length);
  // make sure there aren't any nodes with the same parent entity_id
  expect(Object.keys(groupedAncestorsParent).length).to.eql(ancestors.length);
  ancestors.forEach((node) => {
    const parentID = parentEntityId(node.lifecycle[0]);
    // the last node generated will have `undefined` as the parent entity_id
    if (parentID !== undefined && verifyLastParent) {
      expect(groupedAncestors[parentID]).to.be.ok();
    }
    expectLifecycleNodeInMap(node, tree.ancestry);
  });
};

/**
 * Verify that the children nodes are correct
 *
 * @param children the children nodes
 * @param tree the generated resolver tree as the source of truth
 * @param numberOfParents an optional number to compare that are a certain number of parents in the children array
 * @param childrenPerParent an optional number to compare that there are a certain number of children for each parent
 */
const verifyChildren = (
  children: ChildNode[],
  tree: Tree,
  numberOfParents?: number,
  childrenPerParent?: number
) => {
  // group the children by their entity_id mapped to a child node
  const groupedChildren = _.groupBy(children, (child) => child.entityID);
  // make sure each child is unique
  expect(Object.keys(groupedChildren).length).to.eql(children.length);
  if (numberOfParents !== undefined) {
    const groupParent = _.groupBy(children, (child) => parentEntityId(child.lifecycle[0]));
    expect(Object.keys(groupParent).length).to.eql(numberOfParents);
    if (childrenPerParent !== undefined) {
      Object.values(groupParent).forEach((childNodes) =>
        expect(childNodes.length).to.be(childrenPerParent)
      );
    }
  }

  children.forEach((child) => {
    expectLifecycleNodeInMap(child, tree.children);
  });
};

/**
 * Compare an array of events returned from an API with an array of events generated
 *
 * @param expected an array to use as the source of truth
 * @param toTest the array to test against the source of truth
 * @param lengthCheck an optional flag to check that the arrays are the same length
 */
const compareArrays = (
  expected: Event[],
  toTest: ResolverEvent[],
  lengthCheck: boolean = false
) => {
  if (lengthCheck) {
    expect(expected.length).to.eql(toTest.length);
  }
  toTest.forEach((toTestEvent) => {
    expect(
      expected.find((arrEvent) => {
        return JSON.stringify(arrEvent) === JSON.stringify(toTestEvent);
      })
    ).to.be.ok();
  });
};

/**
 * Verifies that the stats received from ES for a node reflect the categories of events that the generator created.
 *
 * @param relatedEvents the related events received for a particular node
 * @param categories the related event info used when generating the resolver tree
 */
const verifyStats = (stats: ResolverNodeStats | undefined, categories: RelatedEventInfo[]) => {
  expect(stats).to.not.be(undefined);
  let totalExpEvents = 0;
  for (const cat of categories) {
    const ecsCategories = categoryMapping[cat.category];
    if (Array.isArray(ecsCategories)) {
      // if there are multiple ecs categories used to define a related event, the count for all of them should be the same
      // and they should equal what is defined in the categories used to generate the related events
      for (const ecsCat of ecsCategories) {
        expect(stats?.events.byCategory[ecsCat]).to.be(cat.count);
      }
    } else {
      expect(stats?.events.byCategory[ecsCategories]).to.be(cat.count);
    }

    totalExpEvents += cat.count;
  }
  expect(stats?.events.total).to.be(totalExpEvents);
};

/**
 * A helper function for verifying the stats information an array of nodes.
 *
 * @param nodes an array of lifecycle nodes that should have a stats field defined
 * @param categories the related event info used when generating the resolver tree
 */
const verifyLifecycleStats = (nodes: LifecycleNode[], categories: RelatedEventInfo[]) => {
  for (const node of nodes) {
    verifyStats(node.stats, categories);
  }
};

export default function resolverAPIIntegrationTests({ getService }: FtrProviderContext) {
  const supertest = getService('supertest');
  const esArchiver = getService('esArchiver');
  const resolver = getService('resolverGenerator');

  const relatedEventsToGen = [
    { category: RelatedEventCategory.Driver, count: 2 },
    { category: RelatedEventCategory.File, count: 1 },
    { category: RelatedEventCategory.Registry, count: 1 },
  ];

  let resolverTrees: GeneratedTrees;
  let tree: Tree;
  const treeOptions: Options = {
    ancestors: 5,
    relatedEvents: relatedEventsToGen,
    children: 3,
    generations: 2,
    percentTerminated: 100,
    percentWithRelated: 100,
    numTrees: 1,
    alwaysGenMaxChildrenPerNode: true,
  };

  describe('Resolver', () => {
    before(async () => {
      await esArchiver.load('endpoint/resolver/api_feature');
      resolverTrees = await resolver.createTrees(treeOptions);
      // we only requested a single alert so there's only 1 tree
      tree = resolverTrees.trees[0];
    });
    after(async () => {
      await resolver.deleteTrees(resolverTrees);
      // this unload is for an endgame-* index so it does not use data streams
      await esArchiver.unload('endpoint/resolver/api_feature');
    });

    describe('related events route', () => {
      describe('legacy events', () => {
        const endpointID = '5a0c957f-b8e7-4538-965e-57e8bb86ad3a';
        const entityID = '94042';
        const cursor = 'eyJ0aW1lc3RhbXAiOjE1ODE0NTYyNTUwMDAsImV2ZW50SUQiOiI5NDA0MyJ9';

        it('should return details for the root node', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            .get(`/api/endpoint/resolver/${entityID}/events?legacyEndpointID=${endpointID}`)
            .expect(200);
          expect(body.events.length).to.eql(1);
          expect(body.entityID).to.eql(entityID);
          expect(body.nextEvent).to.eql(null);
        });

        it('returns no values when there is no more data', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            // after is set to the document id of the last event so there shouldn't be any more after it
            .get(
              `/api/endpoint/resolver/${entityID}/events?legacyEndpointID=${endpointID}&afterEvent=${cursor}`
            )
            .expect(200);
          expect(body.events).be.empty();
          expect(body.entityID).to.eql(entityID);
          expect(body.nextEvent).to.eql(null);
        });

        it('should return the first page of information when the cursor is invalid', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            .get(
              `/api/endpoint/resolver/${entityID}/events?legacyEndpointID=${endpointID}&afterEvent=blah`
            )
            .expect(200);
          expect(body.entityID).to.eql(entityID);
          expect(body.nextEvent).to.eql(null);
        });

        it('should return no results for an invalid endpoint ID', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            .get(`/api/endpoint/resolver/${entityID}/events?legacyEndpointID=foo`)
            .expect(200);
          expect(body.nextEvent).to.eql(null);
          expect(body.entityID).to.eql(entityID);
          expect(body.events).to.be.empty();
        });

        it('should error on invalid pagination values', async () => {
          await supertest.get(`/api/endpoint/resolver/${entityID}/events?events=0`).expect(400);
          await supertest.get(`/api/endpoint/resolver/${entityID}/events?events=2000`).expect(400);
          await supertest.get(`/api/endpoint/resolver/${entityID}/events?events=-1`).expect(400);
        });
      });

      describe('endpoint events', () => {
        it('should not find any events', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            .get(`/api/endpoint/resolver/5555/events`)
            .expect(200);
          expect(body.nextEvent).to.eql(null);
          expect(body.events).to.be.empty();
        });

        it('should return details for the root node', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/events`)
            .expect(200);
          expect(body.events.length).to.eql(4);
          compareArrays(tree.origin.relatedEvents, body.events, true);
          expect(body.nextEvent).to.eql(null);
        });

        it('should return paginated results for the root node', async () => {
          let { body }: { body: ResolverRelatedEvents } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/events?events=2`)
            .expect(200);
          expect(body.events.length).to.eql(2);
          compareArrays(tree.origin.relatedEvents, body.events);
          expect(body.nextEvent).not.to.eql(null);

          ({ body } = await supertest
            .get(
              `/api/endpoint/resolver/${tree.origin.id}/events?events=2&afterEvent=${body.nextEvent}`
            )
            .expect(200));
          expect(body.events.length).to.eql(2);
          compareArrays(tree.origin.relatedEvents, body.events);
          expect(body.nextEvent).to.not.eql(null);

          ({ body } = await supertest
            .get(
              `/api/endpoint/resolver/${tree.origin.id}/events?events=2&afterEvent=${body.nextEvent}`
            )
            .expect(200));
          expect(body.events).to.be.empty();
          expect(body.nextEvent).to.eql(null);
        });

        it('should return the first page of information when the cursor is invalid', async () => {
          const { body }: { body: ResolverRelatedEvents } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/events?afterEvent=blah`)
            .expect(200);
          expect(body.events.length).to.eql(4);
          compareArrays(tree.origin.relatedEvents, body.events, true);
          expect(body.nextEvent).to.eql(null);
        });
      });
    });

    describe('ancestry events route', () => {
      describe('legacy events', () => {
        const endpointID = '5a0c957f-b8e7-4538-965e-57e8bb86ad3a';
        const entityID = '94042';

        it('should return details for the root node', async () => {
          const { body }: { body: ResolverAncestry } = await supertest
            .get(
              `/api/endpoint/resolver/${entityID}/ancestry?legacyEndpointID=${endpointID}&ancestors=5`
            )
            .expect(200);
          expect(body.ancestors[0].lifecycle.length).to.eql(2);
          expect(body.nextAncestor).to.eql(null);
        });

        it('should have a populated next parameter', async () => {
          const { body }: { body: ResolverAncestry } = await supertest
            .get(`/api/endpoint/resolver/${entityID}/ancestry?legacyEndpointID=${endpointID}`)
            .expect(200);
          expect(body.nextAncestor).to.eql('94041');
        });

        it('should handle an ancestors param request', async () => {
          let { body }: { body: ResolverAncestry } = await supertest
            .get(`/api/endpoint/resolver/${entityID}/ancestry?legacyEndpointID=${endpointID}`)
            .expect(200);
          const next = body.nextAncestor;

          ({ body } = await supertest
            .get(
              `/api/endpoint/resolver/${next}/ancestry?legacyEndpointID=${endpointID}&ancestors=1`
            )
            .expect(200));
          expect(body.ancestors[0].lifecycle.length).to.eql(1);
          expect(body.nextAncestor).to.eql(null);
        });
      });

      describe('endpoint events', () => {
        const getRootAndAncestry = (ancestry: ResolverAncestry) => {
          return { root: ancestry.ancestors[0], ancestry: ancestry.ancestors.slice(1) };
        };

        it('should return details for the root node', async () => {
          const { body }: { body: ResolverAncestry } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/ancestry?ancestors=9`)
            .expect(200);
          // the tree we generated had 5 ancestors + 1 origin node
          expect(body.ancestors.length).to.eql(6);
          const ancestryInfo = getRootAndAncestry(body);
          verifyAncestryFromOrigin(ancestryInfo.root, ancestryInfo.ancestry, tree, true);
          expect(body.nextAncestor).to.eql(null);
        });

        it('should handle an invalid id', async () => {
          const { body }: { body: ResolverAncestry } = await supertest
            .get(`/api/endpoint/resolver/alskdjflasj/ancestry`)
            .expect(200);
          expect(body.ancestors).to.be.empty();
          expect(body.nextAncestor).to.eql(null);
        });

        it('should have a populated next parameter', async () => {
          const { body }: { body: ResolverAncestry } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/ancestry?ancestors=2`)
            .expect(200);
          // it should have 2 ancestors + 1 origin
          expect(body.ancestors.length).to.eql(3);
          const ancestryInfo = getRootAndAncestry(body);
          verifyAncestryFromOrigin(ancestryInfo.root, ancestryInfo.ancestry, tree, false);
          expect(body.nextAncestor).to.eql(
            // it should be the parent entity id on the last element of the ancestry array
            parentEntityId(ancestryInfo.ancestry[ancestryInfo.ancestry.length - 1].lifecycle[0])
          );
        });

        it('should handle multiple ancestor requests', async () => {
          let { body }: { body: ResolverAncestry } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/ancestry?ancestors=3`)
            .expect(200);
          expect(body.ancestors.length).to.eql(4);
          const next = body.nextAncestor;

          ({ body } = await supertest
            .get(`/api/endpoint/resolver/${next}/ancestry?ancestors=1`)
            .expect(200));
          expect(body.ancestors.length).to.eql(2);
          verifyAncestry(body.ancestors, tree, true);
          // the highest node in the generated tree will not have a parent ID which causes the server to return
          // without setting the pagination so nextAncestor will be null
          expect(body.nextAncestor).to.eql(null);
        });
      });
    });

    describe('children route', () => {
      describe('legacy events', () => {
        const endpointID = '5a0c957f-b8e7-4538-965e-57e8bb86ad3a';
        const entityID = '94041';
        const cursor = 'eyJ0aW1lc3RhbXAiOjE1ODE0NTYyNTUwMDAsImV2ZW50SUQiOiI5NDA0MiJ9';

        it('returns child process lifecycle events', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/${entityID}/children?legacyEndpointID=${endpointID}`)
            .expect(200);
          expect(body.childNodes.length).to.eql(1);
          expect(body.childNodes[0].lifecycle.length).to.eql(2);
          expect(
            // for some reason the ts server doesn't think `endgame` exists even though we're using ResolverEvent
            // here, so to avoid it complaining we'll just force it
            (body.childNodes[0].lifecycle[0] as LegacyEndpointEvent).endgame.unique_pid
          ).to.eql(94042);
        });

        it('returns multiple levels of child process lifecycle events', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(
              `/api/endpoint/resolver/93802/children?legacyEndpointID=${endpointID}&generations=1`
            )
            .expect(200);
          expect(body.nextChild).to.be(null);
          expect(body.childNodes[0].nextChild).to.be(null);
          expect(body.childNodes.length).to.eql(8);
          expect(body.childNodes[0].lifecycle.length).to.eql(1);
          expect(
            // for some reason the ts server doesn't think `endgame` exists even though we're using ResolverEvent
            // here, so to avoid it complaining we'll just force it
            (body.childNodes[0].lifecycle[0] as LegacyEndpointEvent).endgame.unique_pid
          ).to.eql(93932);
        });

        it('returns no values when there is no more data', async () => {
          const { body } = await supertest
            // after is set to the document id of the last event so there shouldn't be any more after it
            .get(
              `/api/endpoint/resolver/${entityID}/children?legacyEndpointID=${endpointID}&afterChild=${cursor}`
            )
            .expect(200);
          expect(body.childNodes).be.empty();
          expect(body.nextChild).to.eql(null);
        });

        it('returns the first page of information when the cursor is invalid', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(
              `/api/endpoint/resolver/${entityID}/children?legacyEndpointID=${endpointID}&afterChild=blah`
            )
            .expect(200);
          expect(body.childNodes.length).to.eql(1);
          expect(body.nextChild).to.be(null);
        });

        it('errors on invalid pagination values', async () => {
          await supertest.get(`/api/endpoint/resolver/${entityID}/children?children=0`).expect(400);
          await supertest
            .get(`/api/endpoint/resolver/${entityID}/children?children=2000`)
            .expect(400);
          await supertest
            .get(`/api/endpoint/resolver/${entityID}/children?children=-1`)
            .expect(400);
        });

        it('returns empty events without a matching entity id', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/5555/children`)
            .expect(200);
          expect(body.nextChild).to.eql(null);
          expect(body.childNodes).to.be.empty();
        });

        it('returns empty events with an invalid endpoint id', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/${entityID}/children?legacyEndpointID=foo`)
            .expect(200);
          expect(body.nextChild).to.eql(null);
          expect(body.childNodes).to.be.empty();
        });
      });

      describe('endpoint events', () => {
        it('returns all children for the origin', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/children?children=100`)
            .expect(200);
          // there are 2 levels in the children part of the tree and 3 nodes for each =
          // 3 children for the origin + 3 children for each of the origin's children = 12
          expect(body.childNodes.length).to.eql(12);
          // there will be 4 parents, the origin of the tree, and it's 3 children
          verifyChildren(body.childNodes, tree, 4, 3);
        });

        it('returns a single generation of children', async () => {
          const { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/children?generations=1`)
            .expect(200);
          expect(body.childNodes.length).to.eql(3);
          verifyChildren(body.childNodes, tree, 1, 3);
        });

        it('paginates the children of the origin node', async () => {
          let { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/children?generations=1&children=1`)
            .expect(200);
          expect(body.childNodes.length).to.eql(1);
          verifyChildren(body.childNodes, tree, 1, 1);
          expect(body.nextChild).to.not.be(null);

          ({ body } = await supertest
            .get(
              `/api/endpoint/resolver/${tree.origin.id}/children?generations=1&afterChild=${body.nextChild}`
            )
            .expect(200));
          expect(body.childNodes.length).to.eql(2);
          verifyChildren(body.childNodes, tree, 1, 2);
          expect(body.childNodes[0].nextChild).to.be(null);
          expect(body.childNodes[1].nextChild).to.be(null);
        });

        it('paginates the children of different nodes', async () => {
          let { body }: { body: ResolverChildren } = await supertest
            .get(`/api/endpoint/resolver/${tree.origin.id}/children?generations=2&children=2`)
            .expect(200);
          // it should return 4 nodes total, 2 for each level
          expect(body.childNodes.length).to.eql(4);
          verifyChildren(body.childNodes, tree, 2);
          expect(body.nextChild).to.not.be(null);
          expect(body.childNodes[0].nextChild).to.not.be(null);
          // the second child will not have any results returned for it so it should not have pagination set (the first)
          // request to get it's children should start at the beginning aka not passing any pagination parameter
          expect(body.childNodes[1].nextChild).to.be(null);

          const firstChild = body.childNodes[0];

          // get the 3rd child of the origin of the tree
          ({ body } = await supertest
            .get(
              `/api/endpoint/resolver/${tree.origin.id}/children?generations=1&children=10&afterChild=${body.nextChild}`
            )
            .expect(200));
          expect(body.childNodes.length).to.be(1);
          verifyChildren(body.childNodes, tree, 1, 1);
          expect(body.childNodes[0].nextChild).to.be(null);

          // get the 1 child of the origin of the tree's last child
          ({ body } = await supertest
            .get(
              `/api/endpoint/resolver/${firstChild.entityID}/children?generations=1&children=10&afterChild=${firstChild.nextChild}`
            )
            .expect(200));
          expect(body.childNodes.length).to.be(1);
          verifyChildren(body.childNodes, tree, 1, 1);
          expect(body.childNodes[0].nextChild).to.be(null);
        });
      });
    });

    describe('tree api', () => {
      describe('legacy events', () => {
        const endpointID = '5a0c957f-b8e7-4538-965e-57e8bb86ad3a';

        it('returns ancestors, events, children, and current process lifecycle', async () => {
          const { body }: { body: ResolverTree } = await supertest
            .get(`/api/endpoint/resolver/93933?legacyEndpointID=${endpointID}`)
            .expect(200);
          expect(body.ancestry.nextAncestor).to.equal(null);
          expect(body.relatedEvents.nextEvent).to.equal(null);
          expect(body.children.nextChild).to.equal(null);
          expect(body.children.childNodes.length).to.equal(0);
          expect(body.relatedEvents.events.length).to.equal(0);
          expect(body.lifecycle.length).to.equal(2);
        });
      });

      describe('endpoint events', () => {
        it('returns a tree', async () => {
          const { body }: { body: ResolverTree } = await supertest
            .get(
              `/api/endpoint/resolver/${tree.origin.id}?children=100&generations=3&ancestors=5&events=4`
            )
            .expect(200);

          expect(body.children.nextChild).to.equal(null);
          expect(body.children.childNodes.length).to.equal(12);
          verifyChildren(body.children.childNodes, tree, 4, 3);
          verifyLifecycleStats(body.children.childNodes, relatedEventsToGen);

          expect(body.ancestry.nextAncestor).to.equal(null);
          verifyAncestry(body.ancestry.ancestors, tree, true);
          verifyLifecycleStats(body.ancestry.ancestors, relatedEventsToGen);

          expect(body.relatedEvents.nextEvent).to.equal(null);
          compareArrays(tree.origin.relatedEvents, body.relatedEvents.events, true);

          compareArrays(tree.origin.lifecycle, body.lifecycle, true);
          verifyStats(body.stats, relatedEventsToGen);
        });
      });
    });
  });
}
