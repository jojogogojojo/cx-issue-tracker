import { Module } from '@nestjs/common';
import { FunctionsController } from './functions.controller';
import { AlertController } from './alert.controller';
import { PingController } from './ping.controller';
import { PollRepliesController } from './poll-replies.controller';

@Module({
  controllers: [
    FunctionsController,
    AlertController,
    PingController,
    PollRepliesController,
  ],
})
export class AppModule {}
