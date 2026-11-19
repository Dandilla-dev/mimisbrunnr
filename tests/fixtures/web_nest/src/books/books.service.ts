import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Book } from './book.entity';
import { CreateBookDto } from './create-book.dto';

@Injectable()
export class BooksService {
  constructor(@InjectRepository(Book) private readonly repo: Repository<Book>) {}

  async create(dto: CreateBookDto): Promise<Book> {
    const book = this.repo.create(dto);
    return this.repo.save(book);
  }

  async findOne(id: number): Promise<Book> {
    const book = await this.repo.findOneBy({ id });
    if (!book) throw new NotFoundException(`Book ${id} not found`);
    return book;
  }
}
