import { Book } from '../models/index.js';

export const findBook = async (isbn) => Book.findByPk(isbn);

export const createBook = async (data, options = {}) => Book.create(data, options);
