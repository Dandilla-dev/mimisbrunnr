import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

const Book = sequelize.define('Book', {
  isbn: { type: DataTypes.STRING, primaryKey: true, allowNull: false, validate: { notEmpty: true } },
  title: { type: DataTypes.STRING, allowNull: false },
  year: DataTypes.INTEGER,
}, { tableName: 'books' });

export default Book;
