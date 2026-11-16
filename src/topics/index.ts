import type { TopicModule } from './types';
import { arrayTopic } from './array';
import { matrixTopic } from './matrix';
import { stackTopic } from './stack';
import { queueTopic } from './queue';
import { listTopic } from './list';
import { treeTopic } from './tree';
import { graphTopic } from './graph';

export const TOPICS: TopicModule[] = [
  arrayTopic,
  matrixTopic,
  stackTopic,
  queueTopic,
  listTopic,
  treeTopic,
  graphTopic,
];
