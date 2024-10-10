import { createTRPCReact } from '@trpc/react-query';
import { type AppRouter } from '../configuration/appRouter';

export const TrpcClientSide = createTRPCReact<AppRouter>();
