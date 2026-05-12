import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../../auth/auth.module';
import { SdiController } from './sdi.controller';
import { SdiService } from './sdi.service';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [SdiController],
  providers: [SdiService],
  exports: [SdiService],
})
export class SdiModule {}
