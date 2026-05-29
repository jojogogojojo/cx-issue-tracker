import { Controller, Get } from '@nestjs/common';

@Controller('api/ping')
export class PingController {
  @Get()
  ping() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
