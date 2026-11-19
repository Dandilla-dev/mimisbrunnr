import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BooksController } from './books/books.controller';
import { BooksService } from './books/books.service';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { LoggerMiddleware } from './common/logger.middleware';

@Module({
  controllers: [BooksController],
  providers: [BooksService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).exclude('books/health').forRoutes('books');
  }
}
