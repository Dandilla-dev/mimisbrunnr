import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { BooksService } from './books.service';
import { CreateBookDto } from './create-book.dto';
import { ApiKeyGuard } from '../common/api-key.guard';
import { Public } from '../common/public.decorator';

@Controller('books')
@UseGuards(ApiKeyGuard)
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Post()
  create(@Body() dto: CreateBookDto) {
    return this.booksService.create(dto);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.booksService.findOne(id);
  }
}
