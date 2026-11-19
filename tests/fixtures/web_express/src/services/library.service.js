import * as bookRepository from '../repositories/book.repository.js';
import { Reader } from '../models/index.js';
import { sequelize } from '../models/db.js';

export const addBook = async (data) => {
  const t = await sequelize.transaction();
  try {
    if (await bookRepository.findBook(data.isbn)) {
      throw new Error(`Book ${data.isbn} already exists`);
    }
    const book = await bookRepository.createBook(data, { transaction: t });
    const readers = [];
    for (const r of data.readers || []) {
      readers.push(await Reader.create(r, { transaction: t }));
    }
    await book.setReaders(readers, { transaction: t });
    await t.commit();
    return book;
  } catch (e) {
    await t.rollback();
    throw e;
  }
};

export const getBook = async (isbn) => {
  const book = await bookRepository.findBook(isbn);
  if (!book) throw new Error(`Book ${isbn} not found`);
  return book;
};

export const getReader = async (id) => Reader.findByPk(id);

export const removeReader = async (id) => {
  const reader = await Reader.findByPk(id);
  if (!reader) throw new Error('Reader not found');
  await reader.destroy();
};
